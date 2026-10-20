#!/usr/bin/env python3
"""Bounded NEO sidecar: stage read-only collector facts and deliver the outbox.

This module never imports the controller, Playwright, or any advertising action.
It is intentionally not launched by this repository.
"""
import argparse, hashlib, json, os, time, urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

VERSION = "2026-10-20.v1"
TASK_ID = "499537ec-0aec-4a2e-8b1a-5526c9864d66"
PRODUCER = "neo-happyspa-readonly"
ENDPOINT = "https://happyspa.studio/workbench/api/happyspa-bench/outbox"
MAX_EVENT_AGE_SECONDS = 24 * 60 * 60

def now(): return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
def load(path, fallback):
    try: return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError: return fallback
def save(path, value):
    target = Path(path); target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(target)
def event_id(kind, observed_at, payload):
    raw = json.dumps([VERSION, TASK_ID, kind, observed_at, payload], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()[:32]
def envelope(kind, observed_at, payload):
    return {"contractVersion": VERSION, "producer": PRODUCER, "taskId": TASK_ID,
            "eventId": event_id(kind, observed_at, payload), "kind": kind,
            "observedAt": observed_at, "payload": payload}
def fen(value):
    try:
        decimal = Decimal(str(value)); cents = decimal * 100
        if decimal < 0 or cents != cents.to_integral_value(): raise ValueError
        return int(cents)
    except (InvalidOperation, ValueError): raise ValueError("today_spend is not a non-negative exact yuan amount")
def official_event(snapshot, source_name):
    required = snapshot.get("data_state") == "fresh" and snapshot.get("today_label") == "今日" and snapshot.get("list_loaded") is True and snapshot.get("store_identity_verified") is True
    plans = snapshot.get("plans")
    if not required or not isinstance(plans, list) or snapshot.get("expected_plan_count") != len(plans):
        raise ValueError("official snapshot is incomplete")
    matches = [p for p in plans if p.get("name") == "极速推广20260512557" and p.get("type") == "极速推"]
    if len(matches) != 1: raise ValueError("target plan is not uniquely present")
    observed = snapshot.get("observed_at"); parse_time(observed)
    payload = {"planId": "极速推广20260512557", "planType": "极速推", "todaySpendFen": fen(snapshot.get("today_spend")),
               "sourceAsOf": snapshot.get("data_as_of") if snapshot.get("data_as_of") else None,
               "officialPlanCount": len(plans), "targetStatus": matches[0].get("status"),
               "evidence": [{"kind": "collector_file", "reference": Path(source_name).name}]}
    if payload["targetStatus"] not in ("running", "paused"): raise ValueError("target status is unknown")
    return envelope("official_snapshot", observed, payload)
def heartbeat_event(health):
    observed = health.get("at"); parse_time(observed)
    if health.get("status") != "complete": raise ValueError("collector health is not complete")
    return envelope("neo_heartbeat", observed, {"serviceState": "running", "lastSuccessfulReadAt": observed,
        "detail": "read-only collector complete"})
def stage(path, record):
    records = load(path, [])
    if not isinstance(records, list): raise ValueError("outbox is malformed")
    if not any(isinstance(x, dict) and isinstance(x.get("record"), dict) and x["record"].get("eventId") == record["eventId"] for x in records):
        records.append({"record": record, "attempts": 0, "nextAttemptAt": 0})
        save(path, records)
    return record["eventId"]
def deliver(config, opener=urllib.request.urlopen, clock=time.time):
    if config.get("endpoint") != ENDPOINT: raise ValueError("endpoint is fixed by contract")
    token = os.environ.get(config.get("token_env", "HAPPYSPA_BENCH_OUTBOX_TOKEN"), "")
    if not token: return {"status": "not_configured", "delivered": 0}
    rows, keep, expired, delivered = load(config["outbox"], []), [], load(config["expired_ledger"], []), 0
    for row in rows:
        record = row["record"]
        if clock() - parse_time(record["observedAt"]).timestamp() > MAX_EVENT_AGE_SECONDS:
            expired.append({"eventId": record["eventId"], "expiredAt": now()}); continue
        if row.get("nextAttemptAt", 0) > clock(): keep.append(row); continue
        request = urllib.request.Request(ENDPOINT, data=json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode(), method="POST", headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with opener(request, timeout=10) as response:
                if response.status != 202: raise RuntimeError("receiver rejected event")
            delivered += 1
        except Exception:
            row["attempts"] = int(row.get("attempts", 0)) + 1
            row["nextAttemptAt"] = clock() + min(900, 2 ** min(row["attempts"], 9))
            keep.append(row)
    save(config["outbox"], keep); save(config["expired_ledger"], expired)
    return {"status": "ok", "delivered": delivered, "pending": len(keep), "expired": len(expired)}
def main():
    parser = argparse.ArgumentParser(); parser.add_argument("command", choices=("stage-official", "stage-heartbeat", "flush")); parser.add_argument("--config", required=True); parser.add_argument("--snapshot"); parser.add_argument("--health")
    args = parser.parse_args(); config = load(args.config, None)
    if not isinstance(config, dict): raise SystemExit("valid JSON config is required")
    if args.command == "stage-official": result = {"eventId": stage(config["outbox"], official_event(load(args.snapshot, None), args.snapshot))}
    elif args.command == "stage-heartbeat": result = {"eventId": stage(config["outbox"], heartbeat_event(load(args.health, None)))}
    else: result = deliver(config)
    print(json.dumps(result, ensure_ascii=False))
if __name__ == "__main__": main()
