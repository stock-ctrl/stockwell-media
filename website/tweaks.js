/* Stockwell — lightweight tweaks panel (vanilla, host-protocol compatible).
   Lets the user explore the homepage positioning: top headline + two-track layout.
   NOTE: this was the Claude Design editor panel. It is NOT loaded by the current
   index.html and is kept only for reference / archive. Safe to delete. */
(function () {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "headline": "systems",
    "layout": "side"
  }/*EDITMODE-END*/;

  const HEADLINES = {
    systems: 'We build the systems<br/><span class="accent">businesses run on.</span>',
    range:   'From the job site<br/>to the corner office.<br/><span class="accent">We build the tools between.</span>',
    work:    'Custom software, automation,<br/>and intelligence.<br/><span class="accent">Built around how you work.</span>'
  };

  const LS_KEY = 'sw_tweaks_home';
  let values = Object.assign({}, TWEAK_DEFAULTS);
  try { Object.assign(values, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}

  function apply() {
    const h1 = document.getElementById('hero-h1');
    if (h1 && HEADLINES[values.headline]) h1.innerHTML = HEADLINES[values.headline];
    const tracks = document.getElementById('offerings');
    if (tracks) tracks.setAttribute('data-layout', values.layout);
    document.querySelectorAll('.twk-opt').forEach(function (b) {
      b.classList.toggle('on', values[b.dataset.key] === b.dataset.val);
    });
  }

  function setTweak(key, val) {
    values[key] = val;
    try { localStorage.setItem(LS_KEY, JSON.stringify(values)); } catch (e) {}
    const edits = {}; edits[key] = val;
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: edits }, '*'); } catch (e) {}
    apply();
  }

  function build() {
    const panel = document.createElement('div');
    panel.className = 'twk';
    panel.innerHTML =
      '<div class="twk-hd"><b>Tweaks</b><button class="twk-x" aria-label="Close">✕</button></div>' +
      '<div class="twk-body">' +
        '<div class="twk-row"><span class="twk-lbl">Hero headline</span><div class="twk-seg" data-group="headline">' +
          '<button class="twk-opt" data-key="headline" data-val="systems">Systems</button>' +
          '<button class="twk-opt" data-key="headline" data-val="range">Range</button>' +
          '<button class="twk-opt" data-key="headline" data-val="work">How you work</button>' +
        '</div></div>' +
        '<div class="twk-row"><span class="twk-lbl">Offerings row</span><div class="twk-seg" data-group="layout">' +
          '<button class="twk-opt" data-key="layout" data-val="side">Three across</button>' +
          '<button class="twk-opt" data-key="layout" data-val="stacked">Stacked</button>' +
        '</div></div>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('.twk-x').addEventListener('click', function () {
      panel.classList.remove('open');
      try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {}
    });
    panel.querySelectorAll('.twk-opt').forEach(function (b) {
      b.addEventListener('click', function () { setTweak(b.dataset.key, b.dataset.val); });
    });

    window.addEventListener('message', function (e) {
      const t = e && e.data && e.data.type;
      if (t === '__activate_edit_mode') panel.classList.add('open');
      else if (t === '__deactivate_edit_mode') panel.classList.remove('open');
    });
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
