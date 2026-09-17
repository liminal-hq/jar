# UI mockups — historical reference only

`Jar.dc.html`, `support.js`, and `ios-frame.jsx` are the original Claude Design authoring-tool artifact this app's product design and behaviour were specified from. `.thumbnail` and `uploads/` are its preview screenshots.

**Do not port, adapt, or structurally mirror this code.** It's built on the Claude Design tool's own preview runtime (`<x-dc>`/`<sc-if>`/`<sc-for>`/`{{ }}` bindings, a `DCLogic`-derived `Component` class) — none of that exists in this app, and nothing here should be reached into for code to reuse. Only the *behaviour* it demonstrates is authoritative, and only via `SPEC.md`, `SCREENS.md`, and `docs/architecture/3d-engine.md` — see that last document's §0 for the full reasoning.
