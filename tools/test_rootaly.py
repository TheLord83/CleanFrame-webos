#!/usr/bin/env python3
"""Tests for tools/rootaly.py — the "can this TV be rooted?" judgement.

The point of these cases: a wrong "yes" sends the installer into a patched exploit, so the
tool must answer "unknown" instead of guessing, and it must know the one ceiling we can
state exactly (SlopBro on platform kisscurl, firmware 03.53.45).

    python3 tools/test_rootaly.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rootaly  # noqa: E402


class RootalyTest(unittest.TestCase):
    def test_our_own_tv_is_rootable_with_slopbro(self):
        result = rootaly.advice("43NANO779PA", "6.5.0", "03.51.16")
        self.assertEqual(result["verdict"], "yes")
        self.assertEqual(result["method"], "slopbro")

    def test_above_the_ceiling_is_a_no(self):
        result = rootaly.advice("43NANO779PA", "6.5.0", "03.53.46")
        self.assertEqual(result["verdict"], "no")
        self.assertIn("03.53.45", result["reason"])

    def test_webos_4_is_a_yes_with_faultmanager(self):
        result = rootaly.advice("OLED55C8PLA", "4.5.0", "05.30.10")
        self.assertEqual(result["verdict"], "yes")
        self.assertEqual(result["method"], "faultmanager")

    def test_current_webos_6_firmware_is_unknown_not_yes(self):
        """The latest firmware of webOS 6 is patched almost everywhere - never claim yes."""
        result = rootaly.advice("50NANO816PA", "6.5.0", "03.30.40")
        self.assertEqual(result["verdict"], "unknown")
        self.assertIn("cani.rootmy.tv", result["check"])

    def test_missing_version_is_unknown(self):
        for args in (("", "", ""), ("43NANO779PA", "", ""), ("", "6.5.0", "")):
            self.assertEqual(rootaly.advice(*args)["verdict"], "unknown", args)

    def test_version_parsing_tolerates_text(self):
        self.assertEqual(rootaly._version_tuple("03.51.16"), (3, 51, 16))
        self.assertEqual(rootaly._version_tuple("webOS 6.5.0-2401"), (6, 5, 0))
        self.assertEqual(rootaly._webos_major("webOS 6.5.0-2401"), (6, 5))

    def test_cli_exit_codes(self):
        self.assertEqual(rootaly.main(["--model", "43NANO779PA", "--webos", "6.5",
                                       "--firmware", "03.51.16", "--json"]), 0)
        self.assertEqual(rootaly.main(["--model", "", "--json"]), 1)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RootalyTest)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    total = result.testsRun
    passed = total - len(result.failures) - len(result.errors)
    print("RESULT %d/%d" % (passed, total))
    sys.exit(0 if result.wasSuccessful() else 1)
