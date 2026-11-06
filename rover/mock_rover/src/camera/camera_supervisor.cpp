#include <gst/gst.h>
#include <glib-unix.h>

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>

namespace
{
using Clock = std::chrono::steady_clock;
constexpr auto kTimeout = std::chrono::seconds(20);
constexpr unsigned kRetrySeconds = 3;

std::string env(const char * name, const char * fallback)
{
  const char * value = std::getenv(name);
  return value && *value ? value : fallback;
}

class Camera
{
public:
  Camera(std::string name, const char * pattern, int speed)
  : name_(std::move(name)), pattern_(pattern), speed_(speed) {}

  ~Camera() { stop(); }

  void start()
  {
    retry_id_ = 0;
    const auto bitrate = std::stoi(env("MEDIA_BITRATE_KBPS", "2500"));
    const auto buffer = std::stoi(env("MEDIA_BUFFER_KBPS", "5000"));
    if (bitrate <= 0 || buffer <= 0) throw std::runtime_error("camera bitrate and buffer must be positive");
    std::ostringstream desc;
    desc << "videotestsrc is-live=true pattern=" << pattern_ << " horizontal-speed=" << speed_
         << " ! video/x-raw,width=" << env("MEDIA_WIDTH", "1280")
         << ",height=" << env("MEDIA_HEIGHT", "720") << ",framerate=" << env("MEDIA_FPS", "30") << "/1"
         << " ! videoconvert ! x264enc bitrate=" << bitrate
         << " speed-preset=ultrafast tune=zerolatency key-int-max=" << env("MEDIA_KEYFRAME_INTERVAL", "30")
         << " bframes=0 vbv-buf-capacity=" << (buffer * 1000 / bitrate)
         << " ! video/x-h264,profile=baseline ! whipclientsink name=sink congestion-control=disabled"
         << " signaller::whip-endpoint=http://" << env("BASE_STATION_MEDIA_HOST", "media-gateway")
         << ":8889/" << name_ << "/whip";
    GError * error = nullptr;
    pipeline_ = gst_parse_launch(desc.str().c_str(), &error);
    if (error || !pipeline_) {
      const std::string message = error ? error->message : "pipeline creation failed";
      if (error) g_error_free(error);
      if (pipeline_) { gst_object_unref(pipeline_); pipeline_ = nullptr; }
      schedule_retry(message);
      return;
    }
    sink_ = gst_bin_get_by_name(GST_BIN(pipeline_), "sink");
    GstBus * bus = gst_element_get_bus(pipeline_);
    bus_id_ = gst_bus_add_watch(bus, &Camera::on_bus, this);
    gst_object_unref(bus);
    last_sequence_.reset();
    last_report_ = Clock::now();
    if (gst_element_set_state(pipeline_, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
      schedule_retry("pipeline failed to start");
      return;
    }
    std::cout << name_ << ": publishing" << std::endl;
  }

  bool check()
  {
    if (!pipeline_ || retry_id_) return true;
    GstStructure * stats = nullptr;
    g_object_get(sink_, "stats", &stats, nullptr);
    if (stats) {
      const GValue * session_value = gst_structure_get_value(stats, "unique");
      const GstStructure * session = session_value ? gst_value_get_structure(session_value) : nullptr;
      if (session) {
        for (int i = 0; i < gst_structure_n_fields(session); ++i) {
          const char * key = gst_structure_nth_field_name(session, i);
          if (!g_str_has_prefix(key, "rtp-remote-inbound")) continue;
          const GstStructure * report = gst_value_get_structure(gst_structure_get_value(session, key));
          if (!report) continue;
          const GValue * source_value = gst_structure_get_value(report, "gst-rtpsource-stats");
          const GstStructure * source = source_value ? gst_value_get_structure(source_value) : nullptr;
          gboolean has_report = FALSE;
          guint sequence = 0;
          if (source && gst_structure_get_boolean(source, "have-rb", &has_report) && has_report &&
              gst_structure_get_uint(source, "rb-exthighestseq", &sequence) &&
              (!last_sequence_ || *last_sequence_ != sequence)) {
            last_sequence_ = sequence;
            last_report_ = Clock::now();
          }
        }
      }
      gst_structure_free(stats);
    }
    if (Clock::now() - last_report_ > kTimeout) schedule_retry("receiver reports timed out");
    return true;
  }

  void stop()
  {
    if (retry_id_) { g_source_remove(retry_id_); retry_id_ = 0; }
    if (bus_id_) { g_source_remove(bus_id_); bus_id_ = 0; }
    if (pipeline_) gst_element_set_state(pipeline_, GST_STATE_NULL);
    if (sink_) { gst_object_unref(sink_); sink_ = nullptr; }
    if (pipeline_) { gst_object_unref(pipeline_); pipeline_ = nullptr; }
  }

private:
  void schedule_retry(const std::string & reason)
  {
    if (retry_id_) return;
    std::cout << name_ << ": " << reason << "; retrying" << std::endl;
    stop();
    retry_id_ = g_timeout_add_seconds(kRetrySeconds, [](gpointer data) -> gboolean {
      static_cast<Camera *>(data)->start();
      return G_SOURCE_REMOVE;
    }, this);
  }

  static gboolean on_bus(GstBus *, GstMessage * message, gpointer data)
  {
    auto * camera = static_cast<Camera *>(data);
    if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
      GError * error = nullptr;
      gchar * details = nullptr;
      gst_message_parse_error(message, &error, &details);
      const std::string reason = error ? error->message : "pipeline error";
      if (error) g_error_free(error);
      g_free(details);
      camera->schedule_retry(reason);
      return G_SOURCE_REMOVE;
    }
    if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_EOS) {
      camera->schedule_retry("pipeline ended");
      return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
  }

  std::string name_;
  std::string pattern_;
  int speed_;
  GstElement * pipeline_{nullptr};
  GstElement * sink_{nullptr};
  guint bus_id_{0};
  guint retry_id_{0};
  Clock::time_point last_report_{};
  std::optional<guint> last_sequence_;
};
}  // namespace

int main(int argc, char ** argv)
{
  gst_init(&argc, &argv);
  try {
    Camera front("front", "smpte", 1);
    Camera gimbal("gimbal", "smpte75", -2);
    Camera arm("arm", "ball", 0);
    Camera * cameras[] = {&front, &gimbal, &arm};
    GMainLoop * loop = g_main_loop_new(nullptr, FALSE);
    for (auto * camera : cameras) {
      camera->start();
      g_timeout_add_seconds(1, [](gpointer data) -> gboolean {
        return static_cast<Camera *>(data)->check() ? G_SOURCE_CONTINUE : G_SOURCE_REMOVE;
      }, camera);
    }
    auto quit = [](gpointer data) -> gboolean {
      g_main_loop_quit(static_cast<GMainLoop *>(data));
      return G_SOURCE_REMOVE;
    };
    g_unix_signal_add(SIGINT, quit, loop);
    g_unix_signal_add(SIGTERM, quit, loop);
    g_main_loop_run(loop);
    g_main_loop_unref(loop);
  } catch (const std::exception & error) {
    std::cerr << "camera supervisor: " << error.what() << std::endl;
    return 1;
  }
  return 0;
}
