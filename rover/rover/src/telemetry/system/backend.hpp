#pragma once

#include "../telemetry_backend.hpp"

namespace rover::telemetry::system
{
// Reserved for the subsystem telemetry contract; no publisher is started yet.
class MockBackend : public Backend {};
class RealBackend : public Backend {};
}
