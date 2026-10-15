var response = http.post('http://127.0.0.1:8788/capture', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: SHOT })
});
if (response.status !== 200) throw new Error(response.body);
var captured = json(response.body);
if (captured.width !== 1320 || captured.height !== 2868) throw new Error('Wrong native Simulator dimensions');
console.log(captured.file + ' ' + captured.sha256);
