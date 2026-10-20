import json, os, tempfile, unittest
from pathlib import Path
from happyspa_bench_sender import ENDPOINT, deliver, official_event, stage

class Response:
    status = 202
    def __enter__(self): return self
    def __exit__(self, *_): return False
class SenderTest(unittest.TestCase):
    def test_real_collector_shape_stages_idempotently_and_delivers(self):
        snapshot = {"observed_at":"2026-10-20T10:16:16+08:00","today_spend":7.52,"today_label":"今日","data_state":"fresh","data_as_of":None,"list_loaded":True,"expected_plan_count":1,"store_identity_verified":True,"plans":[{"name":"极速推广20260512557","type":"极速推","status":"running"}]}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); config={"endpoint":ENDPOINT,"outbox":str(root/'outbox.json'),"expired_ledger":str(root/'expired.json')}
            record=official_event(snapshot,"/private/official-snapshot.json"); self.assertEqual(record["payload"]["todaySpendFen"],752)
            self.assertEqual(stage(config["outbox"],record),stage(config["outbox"],record))
            os.environ["HAPPYSPA_BENCH_OUTBOX_TOKEN"]="test-only-token"; seen=[]
            def fake(request, timeout): seen.append(json.loads(request.data)); return Response()
            self.assertEqual(deliver(config,opener=fake,clock=lambda:1729389600)["delivered"],1); self.assertEqual(seen[0]["eventId"],record["eventId"])
    def test_failed_or_expired_records_are_not_sent(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); config={"endpoint":ENDPOINT,"outbox":str(root/'outbox.json'),"expired_ledger":str(root/'expired.json')}; old={"contractVersion":"2026-10-20.v1","producer":"neo-happyspa-readonly","taskId":"499537ec-0aec-4a2e-8b1a-5526c9864d66","eventId":"old","kind":"neo_heartbeat","observedAt":"2020-01-01T00:00:00Z","payload":{}}
            stage(config["outbox"],old); os.environ["HAPPYSPA_BENCH_OUTBOX_TOKEN"]="test-only-token"
            self.assertEqual(deliver(config,opener=lambda *_: self.fail("expired must not send"),clock=lambda:1729389600)["expired"],1)
if __name__ == "__main__": unittest.main()
