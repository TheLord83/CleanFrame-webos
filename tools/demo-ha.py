"""Kleiner Home-Assistant-Ersatz fuer die Reddit-Screenshots.

Liefert nur /api/ und /api/states mit neutralen Demo-Entitaeten, damit auf den
Bildern keine echten Raume, Namen oder Messwerte aus dem Haus stehen.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATES = [
    {"entity_id": "sensor.outdoor_temperature", "state": "18.4",
     "attributes": {"friendly_name": "Outdoor temperature", "unit_of_measurement": "°C",
                    "device_class": "temperature"}},
    {"entity_id": "light.living_room", "state": "on",
     "attributes": {"friendly_name": "Living room light"}},
    {"entity_id": "binary_sensor.front_door", "state": "off",
     "attributes": {"friendly_name": "Front door", "device_class": "door"}},
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj):
        raw = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.rstrip("/") in ("/api", ""):
            return self._send({"message": "API running."})
        if self.path.startswith("/api/states"):
            return self._send(STATES)
        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8088), Handler).serve_forever()
