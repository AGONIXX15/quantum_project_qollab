// Throwaway: does IonQ submission work only while the run's top-level code is still pending?
// A = submit inside the pending top-level await; B/C = let top-level finish ("Done."), submit on click.
import * as probe from 'smoke_probe';
const status = document.getElementById('status');
const out = document.getElementById('out');
const [a, b, c] = ['a', 'b', 'c'].map((id) => document.getElementById(id));

async function submit(label) {
  status.textContent = `${label}: submitting...`;
  const t0 = performance.now();
  try {
    const res = (await probe.ionq_probe.callPromising(backend, 0, 100)).toJs({ dict_converter: Object.fromEntries });
    delete res.traceback;
    status.textContent = `${label}: ${res.ok ? 'OK' : 'FAILED'} (${Math.round(performance.now() - t0)} ms)`;
    out.textContent = JSON.stringify(res, null, 1);
  } catch (err) {
    status.textContent = `${label}: JS error`;
    out.textContent = String(err);
  }
}

status.textContent = `Ready. Backend: ${String(backend.name)}. Choose A or B.`;
const choice = await new Promise((resolve) => {
  a.addEventListener('click', () => resolve('A'), { once: true });
  b.addEventListener('click', () => resolve('B'), { once: true });
});
a.disabled = true;
b.disabled = true;
if (choice === 'A') {
  await submit('A (run active)');
} else {
  c.hidden = false;
  status.textContent = 'Run ended. Wait for "Done." in the Qollab console, then press "Submit after Done".';
  c.addEventListener('click', () => { c.disabled = true; submit('C (after Done)'); }, { once: true });
}
