# DCR Mission Control UI Colour Palette

## Design intent

The DCR Mission Control interface is **inspired by the Airbus ECAM system-display philosophy**: show a calm symbolic system overview during normal operation, use colour consistently to communicate operational meaning, and make abnormal conditions immediately recognisable.

## Operational colour semantics

Use the global CSS variables in `src/styles.scss`. Do not introduce arbitrary status colours in individual components.

| Meaning | CSS variable | Colour | Usage |
| --- | --- | --- | --- |
| Normal / confirmed active | `--dcr-color-normal` | Green | Confirmed healthy or operating telemetry, such as a wheel reporting normal measured RPM. |
| Caution | `--dcr-color-caution` | Amber | Degraded state or condition requiring operator attention. |
| Critical | `--dcr-color-critical` | Red | Fault requiring urgent operator action. |
| Request / information | `--dcr-color-info` | Cyan-blue | Connection and reconnection progress, requested actions, selected mode, and non-fault system information. |
| Neutral | `--dcr-color-neutral` | Muted grey | Static geometry, labels, titles, and normal non-operational context. |
| Offline / unavailable | `--dcr-color-offline` | Dark grey | Missing telemetry, inactive system, or unavailable camera. |

`--dcr-color-text`, `--dcr-color-surface`, `--dcr-color-background`, and `--dcr-color-border` provide the supporting dark mission-control palette.

## Status text and messages

The same palette applies to schematic elements, status text, and operator messages. Text communicates the state of the information it describes:

```text
Normal / confirmed active → green text
Caution                   → amber text
Critical                  → red text
Request / connecting      → cyan-blue text
Static title or label     → neutral text
Offline / unavailable     → dim grey text
```

For example, a static `FRONT CAMERA` label remains neutral, while `CONNECTING`, `LEFT DRIVE NORMAL`, and `LEFT DRIVE FAULT` use cyan-blue, green, and red respectively.

## Display rules

- Use green only for **confirmed** normal or active state, not merely a command requested by the operator.
- Use cyan-blue for requested actions and connection progress; it must not imply that the requested action has completed.
- Keep static rover geometry and labels neutral unless telemetry gives them an operational meaning.
- Use amber before red when the condition is degraded but not immediately critical.
- Do not rely on colour alone. Pair warnings with text, icons, and the global alert area.
- Tooltips can provide detail, but critical conditions must remain visible without hover interaction.
- Keep normal screens low contrast and reserve saturated colours for meaningful state changes.

See [operator-layouts.md](operator-layouts.md) for the Pilot and Arm operator arrangements.
