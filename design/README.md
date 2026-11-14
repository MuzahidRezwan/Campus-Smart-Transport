# Design

```
design/
└── prototype/
    └── index.html    Clickable prototype of the authority dashboard and the student app
```

`prototype/index.html` is a single self-contained HTML file (no build, no server): open it in any browser. It was made from the two hand-drawn sketches (Authority Dashboard and the paid student app) before the real apps were built, to agree on layout and wording. It runs on made-up data and is not connected to the API.

It shows the authority dashboard (greeting header, today's prediction panel, categorized route prediction, Allocate Bus panel, sidebar pages, bottom tabs) and the student app (My Bus, Live Route, My Card, Notification, free vs paid card holder).

The real apps follow the same visual language (DIU blue, one colour per bus company, status colours): [`frontend/web/src/index.css`](../frontend/web/src/index.css). Layout decisions and the improvements over the sketches are explained in [docs/11-ui-ux.md](../docs/11-ui-ux.md).

This folder is not copied into any Docker image.
