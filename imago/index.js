(() => {
  // Imago para o Unbound 3.x — porte do plugin do Revenge.
  // Globais do Unbound (injetadas em cada plugin): React, unbound, addon, logger, patcher.
  const { metro, storage, toasts, flux } = unbound;
  const RN = metro.common && metro.common.ReactNative ? metro.common.ReactNative : require("react-native");
  const { createElement: h, useState, useEffect, useCallback } = React;
  const { View, Text, TextInput, Pressable, Image, Modal, FlatList } = RN;

  const TAG = "[imago]";
  const MARK = "imago-button";
  const DEFAULT_BASE = "https://imago-gamma.vercel.app";
  const TARGET_RE = /ChatInputActions|ChatInputButtons|ChatInputActionButtons|InputActions|ChatInputRight/i;
  const HINT_RE = /gift|emoji|expression|voice|mic|record|sticker|present/i;
  const dbg = new Map();
  const note = (k, v) => { if (dbg.size < 60 && !dbg.has(k)) dbg.set(k, v); };
  const unpatches = [];

  // ---------- camada de compatibilidade (se algum nome da API mudar, só mexa aqui) ----------
  const eager = { lazy: false };
  const find = (...props) => {
    try { return metro.findByProps(...props, eager); } catch {}
    try { return metro.findByProps(...props); } catch {}
    return null;
  };

  let bucket = null;
  const getBucket = () => {
    if (bucket) return bucket;
    try { bucket = storage.getBucket(); } catch (e) { console.error(TAG, "getBucket falhou", e); }
    if (!bucket) bucket = { data: {} };
    return bucket;
  };
  const getCfg = (key, fallback) => {
    const b = getBucket();
    let v;
    try { if (typeof b.get === "function") v = b.get(key); } catch {}
    if (v === undefined && b.data) v = b.data[key];
    return v === undefined || v === null || v === "" ? fallback : v;
  };
  const setCfg = (key, value) => {
    const b = getBucket();
    try { if (typeof b.set === "function") return b.set(key, value); } catch {}
    if (b.data) b.data[key] = value;
  };

  const toast = m => {
    for (const fn of ["open", "show", "add"]) {
      try { if (toasts && typeof toasts[fn] === "function") { toasts[fn]({ content: m, title: m }); return; } } catch {}
    }
    console.log(TAG, m);
  };

  // patcher.after aceitando as duas ordens de argumentos; o callback sempre recebe o retorno como último argumento
  function patchAfter(name, obj, fn) {
    const cb = function () { return fn(arguments[arguments.length - 1]); };
    let un;
    try { un = patcher.after(obj, name, cb); } catch {}
    if (typeof un !== "function") { try { un = patcher.after(name, obj, cb); } catch (e) { console.error(TAG, "patch falhou", name, e); } }
    if (typeof un === "function") unpatches.push(un);
    return typeof un === "function";
  }

  // ---------- busca / envio ----------
  async function search(q) {
    const key = String(getCfg("apiKey", "")).trim();
    if (!key) throw new Error("Coloque sua Imago Key nas configurações do plugin (Plugins > Imago).");
    const base = String(getCfg("base", DEFAULT_BASE)).replace(/\/+$/, "");
    const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&limit=30`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Imago respondeu ${res.status}`);
    return data.results || [];
  }

  function currentChannel() {
    let id;
    try { const st = flux && flux.getStore && flux.getStore("SelectedChannelStore"); id = st && st.getChannelId(); } catch {}
    if (!id) { try { const c = find("getChannelId", "getLastSelectedChannelId"); id = c && c.getChannelId(); } catch {} }
    return id;
  }

  async function sendImage(url) {
    const channelId = currentChannel();
    if (!channelId) return toast("Imago: não achei o canal.");
    try {
      const rest = find("getAPIBaseURL", "post") || find("post", "patch", "del");
      if (rest) {
        const nonce = String(Date.now() * 4194304 + Math.floor(Math.random() * 4194304));
        await rest.post({ url: `/channels/${channelId}/messages`, body: { content: url, tts: false, flags: 0, nonce } });
        return;
      }
    } catch (e) { console.error(TAG, "REST falhou", e); }
    try {
      const msgs = find("sendMessage", "receiveMessage");
      if (msgs) {
        await msgs.sendMessage(channelId, { content: url, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
        return;
      }
    } catch (e) { console.error(TAG, "sendMessage falhou", e); toast("Imago: erro ao enviar: " + ((e && e.message) || e)); return; }
    toast("Imago: não achei como enviar a mensagem.");
  }

  // ---------- UI ----------
  function Picker({ onPick, onClose }) {
    const [q, setQ] = useState("");
    const [items, setItems] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      let dead = false;
      setLoading(true);
      const t = setTimeout(() => {
        search(q)
          .then(r => { if (!dead) { setItems(r); setErr(""); } })
          .catch(e => { if (!dead) setErr(String((e && e.message) || e)); })
          .finally(() => { if (!dead) setLoading(false); });
      }, 350);
      return () => { dead = true; clearTimeout(t); };
    }, [q]);

    return h(Modal, { visible: true, transparent: true, animationType: "slide", onRequestClose: onClose },
      h(View, { style: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" } },
        h(Pressable, { style: { flex: 1 }, onPress: onClose }),
        h(View, { style: { height: "65%", backgroundColor: "#1e1f22", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12 } },
          h(TextInput, {
            value: q, onChangeText: setQ, placeholder: "Buscar no Imago…", placeholderTextColor: "#80848e",
            style: { color: "#fff", backgroundColor: "#2b2d31", borderRadius: 10, padding: 10, marginBottom: 10 }
          }),
          err ? h(Text, { style: { color: "#f23f43", marginBottom: 8 } }, err) : null,
          loading && !items.length ? h(Text, { style: { color: "#b5bac1" } }, "Carregando…") : null,
          !loading && !err && !items.length ? h(Text, { style: { color: "#b5bac1" } }, "Nada encontrado.") : null,
          h(FlatList, {
            data: items, numColumns: 3, keyExtractor: it => it.id,
            renderItem: ({ item }) => h(Pressable, { style: { flex: 1 / 3, aspectRatio: 1, padding: 3 }, onPress: () => onPick(item.url) },
              h(Image, { source: { uri: item.url }, style: { flex: 1, borderRadius: 8, backgroundColor: "#2b2d31" }, resizeMode: "contain" }))
          })
        )
      )
    );
  }

  const ICON = "data:image/png;base64,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";

  function ImagoButton() {
    const [open, setOpen] = useState(false);
    const [ok, setOk] = useState(true);
    const ref = React.useRef(null);
    const pick = useCallback(u => { setOpen(false); sendImage(u); }, []);
    // só aparece na barra real (cópias soltas no canto esquerdo ficam invisíveis)
    const check = () => {
      [60, 400, 1200].forEach(ms => setTimeout(() => {
        try {
          ref.current.measureInWindow((x, y, w, hh) => {
            if (!x && !y) setOk(true);
            else if (!w || !hh) setOk(false);
            else setOk(x >= 8 && y > 0);
          });
        } catch { setOk(true); }
      }, ms));
    };
    return h(View, { ref, onLayout: check, style: { opacity: ok ? 1 : 0 }, pointerEvents: ok ? "auto" : "none" },
      h(Pressable, { onPress: () => setOpen(true), hitSlop: 6, style: { padding: 6 }, accessibilityLabel: "Imago" },
        h(Image, { source: { uri: ICON }, style: { width: 24, height: 24, tintColor: "#b5bac1" } })),
      open && ok ? h(Picker, { onPick: pick, onClose: () => setOpen(false) }) : null
    );
  }

  // ---------- injeção do botão na barra do chat ----------
  const tname = t => {
    if (!t) return "";
    if (typeof t === "string") return t;
    return t.displayName || t.name || (t.type && (t.type.displayName || t.type.name)) || (t.render && (t.render.displayName || t.render.name)) || "";
  };
  const label = el => {
    const p = (el && el.props) || {};
    const ic = p.icon || p.source || p.name || "";
    return `${tname(el && el.type)}|${p.testID || ""}|${p.accessibilityLabel || ""}|${(el && el.key) || ""}|${typeof ic === "string" || typeof ic === "number" ? ic : ""}`;
  };

  function onElement(ret) {
    if (!ret || !ret.props) return ret;
    const kids = ret.props.children;
    if (!Array.isArray(kids) || kids.length < 2 || kids.length > 8) return ret;
    let els = 0;
    for (let i = 0; i < kids.length; i++) if (React.isValidElement(kids[i])) els++;
    if (els < 2) return ret;
    const own = label(ret);
    const labels = kids.map(k => (React.isValidElement(k) ? label(k) : ""));
    const hinted = labels.some(l => HINT_RE.test(l));
    const target = TARGET_RE.test(own);
    if (/ChatInput/i.test(own)) note("ChatInput: " + own, labels.join(" , "));
    if (!hinted && !target) return ret;
    if (labels.some(l => /reaction/i.test(l)) || /reaction/i.test(own)) return ret;
    if (kids.some(k => k && k.key === MARK)) return ret;
    note("container: " + own, labels.join(" , "));
    const copy = kids.slice();
    let last = -1;
    for (let i = 0; i < copy.length; i++) if (React.isValidElement(copy[i])) last = i;
    copy.splice(last < 0 ? copy.length : last, 0, h(ImagoButton, { key: MARK }));
    try { ret.props.children = copy; return ret; }
    catch { return React.cloneElement(ret, { children: copy }); }
  }

  function hook() {
    let n = 0;
    const safe = ret => { try { return onElement(ret); } catch { return ret; } };
    const jsxr = find("jsx", "jsxs");
    if (jsxr) {
      for (const fn of ["jsx", "jsxs"]) if (patchAfter(fn, jsxr, safe)) n++;
    }
    if (patchAfter("createElement", React, safe)) n++;
    console.log(TAG, "hooks:", n);
    return n;
  }

  // ---------- configurações ----------
  function SettingsPage() {
    const [apiKey, setApiKey] = useState(String(getCfg("apiKey", "")));
    const [base, setBase] = useState(String(getCfg("base", DEFAULT_BASE)));
    const [txt, setTxt] = useState("");
    const field = (title, value, onChange, secure) => h(View, { style: { padding: 12 } },
      h(Text, { style: { color: "#b5bac1", marginBottom: 6 } }, title),
      h(TextInput, {
        value, onChangeText: onChange, secureTextEntry: !!secure,
        autoCapitalize: "none", autoCorrect: false,
        style: { color: "#fff", backgroundColor: "#2b2d31", borderRadius: 10, padding: 10 }
      }));
    const dump = () => {
      const lines = [];
      dbg.forEach((v, k) => lines.push(k + "\n  -> " + v));
      setTxt(lines.length ? lines.join("\n\n") : "Nada coletado. Abra um chat, digite algo e volte aqui.");
    };
    return h(View, null,
      field("Imago Key (imk_...)", apiKey, v => { setApiKey(v); setCfg("apiKey", v); }, true),
      field("Endereço do Imago", base, v => { setBase(v); setCfg("base", v); }, false),
      h(View, { style: { padding: 12 } },
        h(Pressable, { onPress: dump, style: { backgroundColor: "#5865f2", borderRadius: 10, padding: 12, alignItems: "center" } },
          h(Text, { style: { color: "#fff" } }, "Diagnóstico do botão")),
        txt ? h(Text, { selectable: true, style: { color: "#b5bac1", marginTop: 10, fontSize: 11 } }, txt) : null));
  }

  return {
    start() {
      hook();
      toast("Imago carregado");
    },
    stop() {
      for (const u of unpatches.splice(0)) { try { u(); } catch {} }
    },
    getSettingsPanel() { return SettingsPage; }
  };
})()
