# Critter Haven

A kid-friendly 3D structural engineering game. Build toy-block structures on a floating island,
brace them with diagonal struts, then test them against earthquakes, hurricanes, floods and hail.
If your building survives 8 seconds, you win. If not, rewind and see exactly which piece broke first.

Stack: Vite, React, TypeScript, Tailwind CSS, three.js, Rapier (`@dimforge/rapier3d-compat`).
Runs fully locally with no external assets (procedural textures, synthesized audio).

```bash
npm install
npm run dev      # start the game
npm run build    # typecheck + production build
npm test         # headless unit/physics tests
```

See [docs/PLAN.md](docs/PLAN.md) for the architecture, module contracts and work packages.
