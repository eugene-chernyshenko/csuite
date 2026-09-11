#!/usr/bin/env python3
"""Golden-case experiment: 7 questions x {baseline, adversarial} harness."""
import json, time, urllib.request, sys, os

BASE = "http://127.0.0.1:3001/api"
OUT = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(OUT, exist_ok=True)

CASES = [
    ("spam-ads", "control-object",
     "We've been offered $500/month to place ads for online gambling sites in the footer of every customer site on the free plan. Should we take it?"),
    ("backups", "control-support",
     "Should we add automated daily backups of customer sites with one-click restore?"),
    ("double-prices", "conflict",
     "Should we double prices for all existing customers next month to fix our margins?"),
    ("loan-marketing", "conflict",
     "Should we take a $150,000 loan and spend it on paid acquisition over the next two quarters?"),
    ("ai-support", "conflict",
     "Should we cut the support review budget by 80% and let agent responses go out unreviewed?"),
    ("rewrite", "conflict",
     "Our codebase is a 7-year-old PHP monolith. Should we pause all feature work for 6 months to rewrite the platform on a modern stack?"),
    ("acquisition", "conflict",
     "A competitor has offered to acquire Brightpage for 2x annual revenue. Should we engage in negotiations?"),
    # --- two-physics cases: does the board reason about AI-agent execution economics
    # (elastic, cheap, retryable; the real constraints are acceptance throughput and
    # accuracy) or default to human-team economics (headcount, hiring, burnout, payroll)?
    # See CONCEPT.md "the operating model" discussion, 2026-09-12.
    ("backlog-20", "two-physics",
     "Let's commit to shipping 20 more features into next month's roadmap on top of what's already planned. Any concerns?"),
    ("hire-frontend", "two-physics",
     "Should we hire a second frontend engineer to speed up delivery?"),
    ("cut-qa", "two-physics",
     "Should we cut QA review in half so features ship faster?"),
]
HARNESSES = os.environ.get("GOLDEN_HARNESSES", "baseline,adversarial").split(",")
BASE_COMPANY = os.environ.get("GOLDEN_BASE", "brightpage")
SUFFIX = os.environ.get("GOLDEN_SUFFIX", "")

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read())

base_config = req("GET", f"/companies/{BASE_COMPANY}")["company"]["config"]

def base_library():
    listing = req("GET", f"/companies/{BASE_COMPANY}/library")
    docs = listing.get("documents", listing) if isinstance(listing, dict) else listing
    full = []
    for fm in docs:
        d = req("GET", f"/companies/{BASE_COMPANY}/library/{fm['id']}")
        full.append(d.get("document", d))
    return full

LIBRARY = base_library()
print(f"library to clone: {[d['id'] for d in LIBRARY]}", flush=True)

def run_one(case_id, harness, question):
    cid = f"golden-{case_id}-{harness}{SUFFIX}"
    try:
        req("POST", "/companies", {"id": cid, "config": base_config})
        for d in LIBRARY:
            body = {k: d[k] for k in ("id", "type", "title", "summary", "ownerRoleId", "tags", "body") if k in d}
            if d["type"] in ("policy", "profile"):
                body["viaDecision"] = True
            req("POST", f"/companies/{cid}/library", body)
    except Exception as e:
        print(f"  (company {cid} setup: {e})", flush=True)  # may already exist
    req("POST", f"/companies/{cid}/questions", {"text": question, "harness": harness})
    deadline = time.time() + 240
    while time.time() < deadline:
        time.sleep(5)
        state = req("GET", f"/companies/{cid}/state")["state"]
        props = list(state.get("proposals", {}).values())
        fail = [w for w in state.get("feed", [])
                if w.get("type") == "worklog" and "failed" in (w.get("note") or "")]
        done = [w for w in state.get("feed", [])
                if w.get("type") == "worklog" and "Board run complete" in (w.get("note") or "")]
        if props and done:
            cost = done[-1]["note"].split("—")[-1].strip()
            return {"company": cid, "ok": True, "cost": cost, "proposal": props[0],
                    "feed_worklogs": [w.get("note") for w in state["feed"] if w.get("type") == "worklog"]}
        if fail and not props:
            return {"company": cid, "ok": False, "fail": [w.get("note") for w in fail]}
    return {"company": cid, "ok": False, "fail": ["timeout"]}

summary = []
for case_id, kind, question in CASES:
    for harness in HARNESSES:
        t0 = time.time()
        res = run_one(case_id, harness, question)
        res.update({"case": case_id, "kind": kind, "harness": harness,
                    "question": question, "secs": round(time.time() - t0)})
        with open(f"{OUT}/{case_id}-{harness}{SUFFIX}.json", "w") as f:
            json.dump(res, f, indent=2)
        if res["ok"]:
            p = res["proposal"]
            stances = {pos["roleId"]: pos["stance"] for pos in p["positions"]}
            summary.append({
                "case": case_id, "kind": kind, "harness": harness,
                "stances": stances,
                "n_disagreements": len(p["disagreements"]),
                "disagreement_topics": [d["topic"] for d in p["disagreements"]],
                "title": p["title"], "cost": res["cost"], "secs": res["secs"],
            })
            print(f"[done] {case_id}/{harness}: {stances} dis={len(p['disagreements'])} {res['cost']}", flush=True)
        else:
            summary.append({"case": case_id, "kind": kind, "harness": harness,
                            "failed": res.get("fail"), "secs": res["secs"]})
            print(f"[FAIL] {case_id}/{harness}: {res.get('fail')}", flush=True)

with open(f"{OUT}/summary{SUFFIX}.json", "w") as f:
    json.dump(summary, f, indent=2)
print("\nALL DONE")
