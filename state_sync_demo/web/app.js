class GlobalStageStore {
  constructor(storageKey, channelName) {
    this.storageKey = storageKey;
    this.listeners = new Set();
    this.sourceId = this.createSourceId();
    this.state = this.loadState();
    this.channel = "BroadcastChannel" in window
      ? new BroadcastChannel(channelName)
      : null;

    if (this.channel) {
      this.channel.onmessage = (event) => this.onChannelMessage(event.data);
    }

    window.addEventListener("storage", (event) => this.onStorage(event));
  }

  createSourceId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `client-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot(), { type: "init" });
    return () => this.listeners.delete(listener);
  }

  getField(fieldKey) {
    return this.state[fieldKey] || "";
  }

  setField(fieldKey, value, meta = {}) {
    if (!fieldKey || typeof fieldKey !== "string") {
      return;
    }

    const normalizedValue = typeof value === "string" ? value : String(value ?? "");
    const current = this.state[fieldKey];
    if (current === normalizedValue) {
      return;
    }

    this.state = {
      ...this.state,
      [fieldKey]: normalizedValue,
    };

    const change = {
      type: "field_changed",
      fieldKey,
      value: normalizedValue,
      sourceId: meta.sourceId || this.sourceId,
      origin: meta.origin || "local",
      timestampMs: Date.now(),
    };

    this.persist();

    if (meta.broadcast !== false && this.channel) {
      this.channel.postMessage(change);
    }

    this.notify(change);
  }

  replaceFromSnapshot(fields, meta = {}) {
    const safeFields = fields && typeof fields === "object" ? fields : {};
    const prevSerialized = JSON.stringify(this.state);
    const nextSerialized = JSON.stringify(safeFields);
    if (prevSerialized === nextSerialized) {
      return;
    }

    this.state = { ...safeFields };
    this.persist();
    this.notify({
      type: "snapshot",
      sourceId: meta.sourceId || "server",
      origin: meta.origin || "remote",
      timestampMs: Date.now(),
    });

    if (meta.broadcast !== false && this.channel) {
      this.channel.postMessage({
        type: "snapshot",
        fields: this.state,
        sourceId: meta.sourceId || "server",
      });
    }
  }

  snapshot() {
    return { ...this.state };
  }

  notify(change) {
    const nextState = this.snapshot();
    this.listeners.forEach((listener) => listener(nextState, change));
  }

  persist() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
  }

  loadState() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  onStorage(event) {
    if (event.key !== this.storageKey || !event.newValue) {
      return;
    }
    try {
      const parsed = JSON.parse(event.newValue);
      this.replaceFromSnapshot(parsed, {
        sourceId: "storage",
        origin: "storage",
        broadcast: false,
      });
    } catch (_err) {
      // ignore malformed storage payload
    }
  }

  onChannelMessage(message) {
    if (!message || message.sourceId === this.sourceId) {
      return;
    }

    if (message.type === "field_changed") {
      this.setField(message.fieldKey, message.value, {
        sourceId: message.sourceId,
        origin: "channel",
        broadcast: false,
      });
      return;
    }

    if (message.type === "snapshot" && message.fields) {
      this.replaceFromSnapshot(message.fields, {
        sourceId: message.sourceId,
        origin: "channel",
        broadcast: false,
      });
    }
  }
}


class PythonSyncTransport {
  constructor(store, logFn, onStatusChange) {
    this.store = store;
    this.log = logFn;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.roomId = "";
    this.connected = false;
  }

  connect(roomId) {
    this.roomId = roomId.trim();
    if (!this.roomId) {
      this.log("Session ID пустой");
      return;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws/${encodeURIComponent(this.roomId)}`;
    this.ws = new WebSocket(url);
    this.onStatusChange(false);
    this.log(`Подключение к ${url}`);

    this.ws.onopen = () => {
      this.connected = true;
      this.onStatusChange(true);
      this.log("WebSocket подключен");
      this.requestSnapshot();
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.onStatusChange(false);
      this.log("WebSocket отключен");
    };

    this.ws.onerror = () => {
      this.log("Ошибка WebSocket");
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  requestSnapshot() {
    this.send({
      type: "request_snapshot",
      sourceId: this.store.sourceId,
    });
  }

  publishFieldChange(fieldKey, value) {
    this.send({
      type: "field_changed",
      fieldKey,
      value,
      sourceId: this.store.sourceId,
    });
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  handleMessage(rawData) {
    let message = null;
    try {
      message = JSON.parse(rawData);
    } catch (_err) {
      this.log("Получен невалидный JSON");
      return;
    }

    if (message.type === "snapshot") {
      this.store.replaceFromSnapshot(message.fields, {
        sourceId: "server",
        origin: "remote",
        broadcast: true,
      });
      this.log(`Снимок состояния v${message.version ?? 0}`);
      return;
    }

    if (message.type === "field_changed") {
      if (message.sourceId === this.store.sourceId) {
        return;
      }
      this.store.setField(message.fieldKey, message.value, {
        sourceId: message.sourceId,
        origin: "remote",
        broadcast: true,
      });
      return;
    }

    if (message.type === "error") {
      this.log(`Ошибка сервера: ${message.message}`);
    }
  }
}


class SyncedFieldController {
  constructor(inputElement, fieldKey, store, transport) {
    this.inputElement = inputElement;
    this.fieldKey = fieldKey;
    this.store = store;
    this.transport = transport;
  }

  bind() {
    this.inputElement.value = this.store.getField(this.fieldKey);

    this.inputElement.addEventListener("input", () => {
      const value = this.inputElement.value;
      this.store.setField(this.fieldKey, value, {
        origin: "local",
        sourceId: this.store.sourceId,
        broadcast: true,
      });
      this.transport.publishFieldChange(this.fieldKey, value);
    });

    this.store.subscribe((state, change) => {
      if (change.type !== "field_changed" && change.type !== "snapshot" && change.type !== "init") {
        return;
      }
      const nextValue = state[this.fieldKey] || "";
      if (this.inputElement.value !== nextValue) {
        const cursor = this.inputElement.selectionStart;
        this.inputElement.value = nextValue;
        if (document.activeElement === this.inputElement && cursor !== null) {
          const pos = Math.min(cursor, nextValue.length);
          this.inputElement.setSelectionRange(pos, pos);
        }
      }
    });
  }
}


function createLogger(logBox) {
  return (text) => {
    const line = document.createElement("div");
    line.className = "log-item";
    const t = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    line.textContent = `[${t}] ${text}`;
    logBox.prepend(line);
    while (logBox.children.length > 80) {
      logBox.removeChild(logBox.lastChild);
    }
  };
}


function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}


function bootstrap() {
  const stateDump = document.getElementById("stateDump");
  const statusBadge = document.getElementById("statusBadge");
  const clientMeta = document.getElementById("clientMeta");
  const connectBtn = document.getElementById("connectBtn");
  const sessionIdInput = document.getElementById("sessionId");
  const logBox = document.getElementById("logBox");

  const log = createLogger(logBox);
  const store = new GlobalStageStore("global-stage:v1", "global-stage:channel");
  const transport = new PythonSyncTransport(store, log, (online) => {
    statusBadge.textContent = online ? "online" : "offline";
    statusBadge.className = online ? "badge online" : "badge offline";
  });

  clientMeta.textContent = `clientId: ${store.sourceId}`;

  new SyncedFieldController(
    document.getElementById("fieldEmail"),
    "form.email",
    store,
    transport
  ).bind();

  new SyncedFieldController(
    document.getElementById("fieldUsername"),
    "form.username",
    store,
    transport
  ).bind();

  new SyncedFieldController(
    document.getElementById("fieldComment"),
    "form.comment",
    store,
    transport
  ).bind();

  store.subscribe((state, change) => {
    stateDump.textContent = prettyJson({
      state,
      lastChange: change,
    });
  });

  connectBtn.addEventListener("click", () => {
    transport.connect(sessionIdInput.value);
  });

  log("Store инициализирован");
  log("Нажми 'Подключиться' и открой вторую вкладку");
}


window.addEventListener("load", bootstrap);

