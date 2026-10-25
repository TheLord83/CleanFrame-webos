#!/usr/bin/env python3
"""Tests for tools/discover.py — the part that decides what counts as a TV.

The expensive, network-touching functions (SSDP search, port scan, SSAP handshake,
Glasshouse fingerprint) are replaced here, so the test is fast, offline and runs in CI.
What it proves: only a device that really answers like a webOS TV becomes a host, and
everything else that merely shows up in SSDP (router, repeater, Fire TV, printer) is
reported as rejected instead of being offered as "the TV".

    python3 tools/test_discover.py
"""
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import discover  # noqa: E402


class DiscoverTest(unittest.TestCase):
    def setUp(self):
        # Saved originals, restored in tearDown
        self.orig = (discover.ssdp_search, discover.scan, discover.port_open,
                     discover.looks_like_ssap, discover.looks_like_glasshouse,
                     discover.describe, discover.local_subnets)

    def tearDown(self):
        (discover.ssdp_search, discover.scan, discover.port_open,
         discover.looks_like_ssap, discover.looks_like_glasshouse,
         discover.describe, discover.local_subnets) = self.orig

    def stub(self, ssdp=None, scan_hosts=None, open_ports=None, ssap=None,
             glasshouse=None, names=None):
        discover.ssdp_search = lambda timeout=3.0: ssdp or {}
        discover.scan = lambda subnet, timeout=0.3: scan_hosts or {}
        discover.port_open = lambda ip, port, timeout: port in (open_ports or {}).get(ip, [])
        discover.looks_like_ssap = lambda ip, timeout=3.0: ip in (ssap or [])
        discover.looks_like_glasshouse = lambda ip, timeout=3.0: ip in (glasshouse or [])
        discover.describe = lambda location, timeout=3.0: {"name": (names or {}).get(location, "")}
        discover.local_subnets = lambda: ["192.168.178.0/24"]

    def test_router_repeater_stick_are_rejected(self):
        """SSDP answers alone are not enough — this was a real false-positive bug."""
        self.stub(
            ssdp={
                "192.168.178.1": {"ip": "192.168.178.1", "ssdp": True,
                                  "location": "http://192.168.178.1:49000/desc.xml"},
                "192.168.178.130": {"ip": "192.168.178.130", "ssdp": True,
                                    "location": "http://192.168.178.130:49000/desc.xml"},
                "192.168.178.155": {"ip": "192.168.178.155", "ssdp": True,
                                    "location": "http://192.168.178.155:60000/desc.xml"},
            },
            names={
                "http://192.168.178.1:49000/desc.xml": "FRITZ!Box 6660 Cable",
                "http://192.168.178.130:49000/desc.xml": "FRITZ!Repeater 1200 AX",
                "http://192.168.178.155:60000/desc.xml": "Fire TV Stick",
            },
        )
        result = discover.find(timeout=0.01)
        self.assertEqual(result["hosts"], [])
        self.assertEqual(len(result["rejected"]), 3)
        self.assertEqual(
            [host["name"] for host in result["rejected"]],
            ["FRITZ!Box 6660 Cable", "FRITZ!Repeater 1200 AX", "Fire TV Stick"],
        )

    def test_ssap_handshake_makes_a_host(self):
        self.stub(
            ssdp={"192.168.178.42": {"ip": "192.168.178.42", "ssdp": True,
                                     "location": "http://192.168.178.42:1900/desc.xml"}},
            open_ports={"192.168.178.42": [3000, 3001, 22, 8080]},
            ssap=["192.168.178.42"],
            names={"http://192.168.178.42:1900/desc.xml": "[LG] webOS TV OLED55C47LA"},
        )
        result = discover.find(timeout=0.01)
        self.assertEqual(result["rejected"], [])
        self.assertEqual(len(result["hosts"]), 1)
        host = result["hosts"][0]
        self.assertEqual(host["ip"], "192.168.178.42")
        self.assertEqual(host["name"], "[LG] webOS TV OLED55C47LA")
        self.assertTrue(host["rooted"])
        self.assertTrue(host["glasshouse"])
        self.assertEqual(host["ports"], {"22": "ssh", "3000": "ssap",
                                         "3001": "ssap-secure", "8080": "glasshouse"})

    def test_glasshouse_alone_is_enough(self):
        """A rooted TV with a closed SSAP port still gets found through Glasshouse."""
        self.stub(
            scan_hosts={"192.168.178.50": {"ip": "192.168.178.50",
                                           "ports": {8080: "glasshouse"}}},
            ssap=[],
            glasshouse=["192.168.178.50"],
        )
        result = discover.find(timeout=0.01)
        self.assertEqual([host["ip"] for host in result["hosts"]], ["192.168.178.50"])

    def test_port_scan_hit_without_ssap_is_rejected(self):
        self.stub(
            scan_hosts={"192.168.178.60": {"ip": "192.168.178.60", "ports": {23: "telnet"}}},
            ssap=[],
        )
        result = discover.find(timeout=0.01)
        self.assertEqual(result["hosts"], [])
        self.assertEqual([host["ip"] for host in result["rejected"]], ["192.168.178.60"])

    def test_json_output_has_both_lists(self):
        self.stub(ssdp={"192.168.178.1": {"ip": "192.168.178.1", "ssdp": True}},
                  names={"192.168.178.1": "FRITZ!Box"})
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = discover.main(["--json"])
        payload = json.loads(buffer.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(payload["found"], 0)
        self.assertEqual(len(payload["rejected"]), 1)

    def test_exit_code_zero_when_a_tv_is_found(self):
        self.stub(ssdp={"192.168.178.42": {"ip": "192.168.178.42"}},
                  open_ports={"192.168.178.42": [3000]},
                  ssap=["192.168.178.42"])
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = discover.main(["--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(buffer.getvalue())["found"], 1)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(DiscoverTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    total = result.testsRun
    passed = total - len(result.failures) - len(result.errors)
    print("RESULT %d/%d" % (passed, total))
    sys.exit(0 if result.wasSuccessful() else 1)
