// Stub of the two Open-Meteo endpoints, so the weather checks run without the internet.
var http = require('http');
var port = parseInt(process.env.WX_PORT || '8899', 10);
http.createServer(function (q, s) {
  s.setHeader('Content-Type', 'application/json');
  if (q.url.indexOf('/v1/forecast') === 0) {
    return s.end(JSON.stringify({
      current_weather: { temperature: 17.6, weathercode: 3 },
      daily: { temperature_2m_max: [19.4], temperature_2m_min: [11.2] }
    }));
  }
  if (q.url.indexOf('/v1/search') === 0) {
    if (q.url.indexOf('name=Nowhere') > 0) return s.end(JSON.stringify({}));
    return s.end(JSON.stringify({ results: [{ name: 'Kiel', country_code: 'DE', latitude: 54.3233, longitude: 10.1228 }] }));
  }
  s.statusCode = 404;
  s.end('{}');
}).listen(port, function () { console.log('wx stub on ' + port); });
