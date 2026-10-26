#!/usr/bin/env python3
"""Offline tests for tools/tvinfo.py — the parsers, not the network.

Sockets are replaced, so this runs in CI. What it proves: an LG-style SSDP description is
read correctly, a firmware field is picked up when the TV offers one, and the tool admits
"not complete" instead of inventing a version.

    python3 tools/test_tvinfo.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tvinfo  # noqa: E402

LG_DESCRIPTION = """<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>[LG] webOS TV NANO779PA</friendlyName>
    <manufacturer>LG Electronics</manufacturer>
    <modelName>LG 43NANO779PA</modelName>
    <modelNumber>43NANO779PA</modelNumber>
    <UDN>uuid:5f1c0e2a-0000-0000-0000-000000000000</UDN>
  </device>
</root>"""

WITH_VERSION = """<root><device><modelName>LG 50NANO816PA</modelName>
<firmwareVersion>03.30.40</firmwareVersion></device></root>"""


class TvinfoTest(unittest.TestCase):
    def setUp(self):
        self.orig = (tvinfo.ssdp_search, tvinfo.airplay, tvinfo.ssap_handshake,
                     tvinfo.ssap_unauth)

    def tearDown(self):
        (tvinfo.ssdp_search, tvinfo.airplay, tvinfo.ssap_handshake,
         tvinfo.ssap_unauth) = self.orig
        tvinfo.ssap_unauth = lambda ip, port=3000, timeout=3.0: {}

    def test_xml_fields_read_an_lg_description(self):
        fields = tvinfo._xml_fields(LG_DESCRIPTION)
        self.assertEqual(fields["modelName"], "LG 43NANO779PA")
        self.assertEqual(fields["modelNumber"], "43NANO779PA")
        self.assertEqual(fields["friendlyName"], "[LG] webOS TV NANO779PA")
        self.assertEqual(fields["manufacturer"], "LG Electronics")

    def test_firmware_field_is_picked_up_when_present(self):
        fields = tvinfo._xml_fields(WITH_VERSION)
        self.assertEqual(fields["firmwareVersion"], "03.30.40")

    def test_collect_marks_incomplete_without_firmware(self):
        tvinfo.ssdp_search = lambda ip, timeout=2.0: {
            "description": tvinfo._xml_fields(LG_DESCRIPTION),
            "descriptionUrl": "http://192.168.178.33:1900/"}
        tvinfo.airplay = lambda ip, timeout=2.0: {}
        tvinfo.ssap_handshake = lambda ip, port=3000, timeout=2.0: True
        info = tvinfo.collect("192.168.178.33")
        self.assertEqual(info["modelName"], "LG 43NANO779PA")
        self.assertEqual(info["firmware"], "")
        self.assertFalse(info["complete"])
        self.assertTrue(info["ssap"])
        self.assertIn("ssap:3000", info["sources"])

    def test_collect_is_complete_with_model_and_firmware(self):
        tvinfo.ssdp_search = lambda ip, timeout=2.0: {"description": tvinfo._xml_fields(WITH_VERSION)}
        tvinfo.airplay = lambda ip, timeout=2.0: {}
        tvinfo.ssap_handshake = lambda ip, port=3000, timeout=2.0: False
        info = tvinfo.collect("192.168.0.5")
        self.assertTrue(info["complete"])
        self.assertEqual(info["firmware"], "03.30.40")

    def test_model_and_serial_come_from_the_unpaired_ssap_call(self):
        """Measured on a real TV: getSystemInfo answers without pairing, model + serial."""
        tvinfo.ssdp_search = lambda ip, timeout=2.0: {}
        tvinfo.airplay = lambda ip, timeout=2.0: {}
        tvinfo.ssap_handshake = lambda ip, port=3000, timeout=2.0: True
        tvinfo.ssap_unauth = lambda ip, port=3000, timeout=3.0: {
            "modelName": "43NANO779PA", "serialNumber": "000MANJ00000"}
        info = tvinfo.collect("192.168.1.50")
        self.assertEqual(info["modelName"], "43NANO779PA")
        self.assertEqual(info["serial"], "000MANJ00000")
        self.assertFalse(info["complete"])   # firmware still unknown

    def test_airplay_model_is_a_fallback(self):
        tvinfo.ssdp_search = lambda ip, timeout=2.0: {}
        tvinfo.airplay = lambda ip, timeout=2.0: {"model": "LG OLED55C8PLA", "osv": "webOS 4.5.0"}
        tvinfo.ssap_handshake = lambda ip, port=3000, timeout=2.0: False
        info = tvinfo.collect("192.168.0.6")
        self.assertEqual(info["modelName"], "LG OLED55C8PLA")
        self.assertEqual(info["webOs"], "webOS 4.5.0")


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TvinfoTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    total = result.testsRun
    passed = total - len(result.failures) - len(result.errors)
    print("RESULT %d/%d" % (passed, total))
    sys.exit(0 if result.wasSuccessful() else 1)
