# ML service

Predicts how many students and faculty will ride each trip, and suggests which buses to send. An internal FastAPI service: only the API calls it, with a shared token, and it keeps no personal data (only trained model files).

Python 3.12, FastAPI, pandas, scikit-learn (gradient-boosted trees), PuLP (CBC solver), pdfplumber / openpyxl / BeautifulSoup for reading routines.

## How a prediction is made

1. **Routine count (rules).** Each card holder's department, batch and section (or teacher initial) is matched to the class routine: the first class picks the morning trip that arrives in time, the last class picks the first trip home after it. This is the most people who could need each trip. → `app/demand.py`
2. **Ridership forecast (ML).** A model learns what share of them actually ride, from boarding scans, weekday, exams and holidays, and gives a 90th-percentile figure so seats cover about 9 days in 10. Before enough scans exist, a configurable attendance factor is used. → `app/features.py`, `app/model.py`, `app/forecast.py`
3. **Bus allocation (optimization).** A mixed-integer program covers the demand first, then uses as few buses and wastes as few seats as possible, mixing companies and reusing a bus across trips that do not overlap (greedy fallback if the solver is unavailable). The office reviews and publishes. → `app/optimizer.py`

Numbers and reasoning: [docs/06-ml-design.md](../../docs/06-ml-design.md).

## Run

```bash
cd backend/ml
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.train --synthetic          # train + back-test on generated data, promote if better
.venv/bin/uvicorn app.main:app --port 8000          # http://localhost:8000/health
.venv/bin/pip install pytest && .venv/bin/python -m pytest
```

Train on real data exported by the API: `npm run ml:export -w @diu/api -- training-export.json`, then `python -m app.train --input training-export.json`. Delete the export afterwards (it is pseudonymised but still personal data).

## Endpoints

| Method and path | What it does |
|---|---|
| `GET /health` | Liveness check (no token) |
| `POST /v1/forecast` | Expected and predicted riders per trip for the given dates |
| `POST /v1/allocation/plan` | Suggested buses for a day |
| `POST /v1/routines/parse` | Read an uploaded routine file (CSV, Excel, PDF, Word, HTML) |
| `POST /v1/routines/fetch` | Download and read a routine from an allowed department website |

## Files

```
backend/ml/
├── requirements.txt     Runtime dependencies (PuLP kept below 4: it bundles the CBC solver)
├── pyproject.toml       Same dependencies as a Python project, plus pytest settings
├── Dockerfile           Production image (non-root user, health check)
├── .dockerignore        Keeps .venv, caches, tests and .env out of the image
├── .env.example         ML_SERVICE_TOKEN, MODEL_DIR, ALLOWED_FETCH_HOSTS placeholders
├── app/
│   ├── main.py          FastAPI app, token check, the endpoints above
│   ├── schemas.py       Request/response models (camelCase on the wire, like the API)
│   ├── demand.py        Routine count per trip; list of DIU departments
│   ├── features.py      Features shared by training and prediction
│   ├── model.py         Ridership model and the model store (artifacts/)
│   ├── forecast.py      Routine count → model → predicted and P90 riders per trip
│   ├── optimizer.py     Bus allocation as a mixed-integer program
│   ├── routine_parser.py  Reads routines: standard template or department grid; CSV, Excel, PDF, Word, HTML
│   ├── fetcher.py       Safe downloads from department websites (HTTPS, allow-listed public hosts, size/time limits)
│   ├── synthetic.py     Realistic generated data, so everything can be built and tested before real data
│   └── train.py         Train, back-test and promote a model (--synthetic or --input)
├── data/
│   └── routine-template.csv  Standard routine format departments can upload
├── artifacts/           Trained models (git-ignored; only .gitkeep is committed)
└── tests/
    ├── test_demand.py           Routine count
    ├── test_routine_parser.py   Reading routine files
    ├── test_fetcher.py          Following a department notice to its routine file
    ├── test_optimizer.py        Bus allocation
    └── test_model_and_api.py    Training, prediction and the HTTP endpoints
```
