// Content script - Bridges page and background script

// Signal a real document load to the background script. Content scripts are
// re-injected on every full page load/reload but NOT on SPA route changes
// (history.pushState/replaceState), so this is the reliable moment — and the
// only one — to clear a tab's stale WebSocket connections. Top frame only,
// so an iframe reload never wipes the parent page's connections.
if (window === window.top) {
  try {
    chrome.runtime.sendMessage({ type: "page-loaded" }).catch(() => {
      // Ignore — background may not be ready yet
    });
  } catch (error) {
    // Ignore — extension context may be reloading
  }
}

// Check if extension is enabled
function checkExtensionEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["websocket-proxy-enabled"], (result) => {
      resolve(result["websocket-proxy-enabled"] !== false); // Default enabled
    });
  });
}

// Message deduplication mechanism with frame context
let messageIdCounter = 0;
function generateMessageId() {
  const frameContext = window.location.href; // Include iframe context
  return `msg_${Date.now()}_${++messageIdCounter}_${Math.random()
    .toString(36)
    .substr(2, 9)}_${frameContext.length}`;
}

// Inject using external file to avoid CSP inline script restrictions
function injectWebSocketProxy() {

  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/content/injected.js");
    script.onload = function () {
      this.remove(); // Clean up script tag
    };
    script.onerror = function () {
    };

    // Inject as early as possible
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
  }
}

// Execute injection after checking extension status
checkExtensionEnabled().then((enabled) => {
  if (enabled) {
    if (document.readyState === "loading") {
      injectWebSocketProxy();
    } else {
      injectWebSocketProxy();
    }
    

  } else {
  }
});

// Listen for messages from injected script
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || !event.data.source) return;

  if (event.data.source === "websocket-proxy-injected") {

    // Handle batched events
    if (event.data.type === "websocket-event-batch") {
      const batch = event.data.payload;
      if (!batch || !Array.isArray(batch)) return;

      const batchWithIds = batch.map(item => {
        // Generate ID if missing (should be present for messages, but safe to add)
        // Also ensure timestamp and source are correct
        return {
          ...item,
          messageId: item.messageId || generateMessageId(),
          timestamp: item.timestamp || Date.now(),
          source: "content-script", // Retag source for background
        };
      });

      // Send batch to Background Script
      chrome.runtime
        .sendMessage({
          type: "websocket-event-batch",
          data: batchWithIds,
          timestamp: Date.now(),
          source: "content-script"
        })
        .catch(() => {
           // Ignore errors
        });

      return;
    }

    // Handle keep-alive messages
    if (event.data.type === "keep-alive") {
      // Just acknowledge to keep connection alive
      return;
    }

    // Handle active keep-alive from page context
    if (event.data.type === "keep-alive-active") {
      // Forward active keep-alive to background script
      chrome.runtime.sendMessage({
        type: "keep-alive-active",
        timestamp: event.data.timestamp,
        source: "page-context"
      }).catch(() => {
        // Ignore errors
      });
      return;
    }

    // Add unique ID to message for deduplication
    const messageId = generateMessageId();
    
    const messageWithId = {
      type: "websocket-event",
      data: event.data.payload,
      messageId: messageId,
      timestamp: Date.now(),
      source: "content-script",
      frameContext: {
        url: window.location.href,
        stableId: (() => {
          try {
            const url = new URL(window.location.href);
            return `${url.origin}${url.pathname}`;
          } catch (e) {
            return window.location.href;
          }
        })(),
        isIframe: window !== window.top,
        frameId: window !== window.top ? (() => {
          try {
            const url = new URL(window.location.href);
            return `${url.origin}${url.pathname}`;
          } catch (e) {
            return window.location.href;
          }
        })() : null
      }
    };
    


    // Send directly to DevTools Panel, also send to Background Script for data storage
    chrome.runtime
      .sendMessage(messageWithId)
      .then((response) => {
        // Response handled successfully
      })
      .catch((error) => {
        // This is normal if no listener responds
      });
  }
});

// Listen for control messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Handle keep-alive messages
  if (message.type === "keep-alive") {
    // Forward keep-alive to injected script
    window.postMessage({
      source: "websocket-proxy-content",
      type: "keep-alive",
      timestamp: message.timestamp
    }, "*");
    
    // Respond to background script
    sendResponse({ received: true });
    return;
  }

  // Forward control commands to injected script
  switch (message.type) {
    case "start-monitoring":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "start-monitoring",
        },
        "*"
      );
      break;

    case "stop-monitoring":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "stop-monitoring",
        },
        "*"
      );
      break;

    case "block-outgoing":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "block-outgoing",
          enabled: message.enabled,
        },
        "*"
      );
      break;

    case "block-incoming":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "block-incoming",
          enabled: message.enabled,
        },
        "*"
      );
      break;

    case "ignore-connection":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "ignore-connection",
          connectionId: message.connectionId,
        },
        "*"
      );
      break;

    case "unignore-connection":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "unignore-connection",
          connectionId: message.connectionId,
        },
        "*"
      );
      break;

    case "resume-traffic-monitoring":
      console.log("[WebSocket Proxy Content] Forwarding resume-traffic-monitoring to page");
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "resume-traffic-monitoring",
        },
        "*"
      );
      sendResponse({ success: true, forwarded: true });
      break;

    case "get-proxy-state":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "get-proxy-state",
        },
        "*"
      );
      break;

    case "simulate-message":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "simulate-message",
          connectionId: message.connectionId,
          message: message.message,
          direction: message.direction,
        },
        "*"
      );
      break;

    case "simulate-system-event":
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "simulate-system-event",
          connectionId: message.connectionId,
          eventType: message.eventType,
          code: message.code,
          reason: message.reason,
          message: message.message,
          errorType: message.errorType,
        },
        "*"
      );
      break;

    case "show-devtools-hint":
      // Can display a temporary hint on the page
      showDevToolsHint();
      break;

    case "create-manual-websocket":
      // Forward to injected script to create WebSocket connection
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "create-manual-websocket",
          url: message.url,
        },
        "*"
      );
      break;
    // NEW: Reset proxyState to initial value
    case "reset-proxy-state": {
      window.postMessage(
        {
          source: "websocket-proxy-content",
          type: "reset-proxy-state",
        },
        "*"
      );
      break;
    }
    default:
      break;
  }

  sendResponse({ received: true });
});

// Display DevTools hint
function showDevToolsHint() {
  // Create styles first
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInBounce {
      0% {
        transform: translateX(120%) scale(0.8);
        opacity: 0;
      }
      60% {
        transform: translateX(-10px) scale(1.05);
        opacity: 1;
      }
      100% {
        transform: translateX(0) scale(1);
        opacity: 1;
      }
    }
    
    @keyframes slideOutBounce {
      0% {
        transform: translateX(0) scale(1);
        opacity: 1;
      }
      40% {
        transform: translateX(-10px) scale(1.02);
        opacity: 0.8;
      }
      100% {
        transform: translateX(120%) scale(0.9);
        opacity: 0;
      }
    }
    
    @keyframes float {
      0%, 100% {
        transform: translateY(0px);
      }
      50% {
        transform: translateY(-2px);
      }
    }
    
    .ws-devtools-hint {
      position: relative;
    }
    
    .ws-devtools-hint::before {
      content: '';
      position: absolute;
      top: -2px;
      left: -2px;
      right: -2px;
      bottom: -2px;
      background: linear-gradient(35deg, #50ae8e, #000604, #9a7413, #000000);
      border-radius: 18px;
      z-index: -1;
      opacity: 0.3;
      animation: float 3s ease-in-out infinite;
    }
    
    .ws-hint-closing {
      animation: slideOutBounce 0.4s ease-in-out forwards !important;
    }
    
    .ws-hint-button {
      background: #047857;
      color: #e5e7eb;
      border: 1px solid #065f46;
      padding: 12px 24px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.3s ease;
      box-shadow: 0 2px 6px rgba(4, 120, 87, 0.2);
      backdrop-filter: blur(10px);
      font-family: inherit;
      outline: none !important;
    }
    
    .ws-hint-button:hover {
      background: #059669 !important;
      box-shadow: 0 3px 8px rgba(5, 150, 105, 0.25) !important;
      border-color: #047857 !important;
    }
    
    .ws-hint-button:active {
      box-shadow: 0 1px 4px rgba(4, 120, 87, 0.3) !important;
    }
    
    .ws-hint-button:focus {
      outline: none !important;
      box-shadow: 0 2px 6px rgba(4, 120, 87, 0.2), 0 0 0 2px rgba(16, 185, 129, 0.15) !important;
    }
    
    .ws-devtools-hint * {
      outline: none !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    
    .ws-devtools-hint *:focus {
      outline: none !important;
    }
  `;
  document.head.appendChild(style);

  // Create main container
  const hint = document.createElement("div");
  const hintContent = document.createElement("div");
  hintContent.className = "ws-devtools-hint";
  
  // Set styles for main container
  Object.assign(hintContent.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: "linear-gradient(135deg,rgb(20, 28, 40) 0%,rgb(37, 48, 62) 50%,rgb(49, 59, 73) 100%)",
    color: "#f1f5f9",
    padding: "24px",
    borderRadius: "16px",
    boxShadow: "0 12px 32px rgba(0,0,0,0.4), 0 8px 16px rgba(0,0,0,0.3)",
    zIndex: "10000",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: "14px",
    maxWidth: "360px",
    border: "1px solid rgba(148, 163, 184, 0.3)",
    backdropFilter: "blur(20px)",
    animation: "slideInBounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
    transformOrigin: "right center"
  });

  // Create header section
  const headerDiv = document.createElement("div");
  Object.assign(headerDiv.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "20px"
  });

  // Create icon container
  const iconContainer = document.createElement("div");
  Object.assign(iconContainer.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "40px",
    height: "40px",
    background: "rgba(16, 185, 129, 0.15)",
    borderRadius: "10px",
    border: "1px solid rgba(16, 185, 129, 0.3)"
  });

  // Create SVG icon
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#10b981");
  svg.setAttribute("stroke-width", "2.5");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M22 12h-4l-3 9L9 3l-3 9H2");
  svg.appendChild(path);
  iconContainer.appendChild(svg);

  // Create text container
  const textContainer = document.createElement("div");
  
  const titleDiv = document.createElement("div");
  titleDiv.textContent = "WebSocket DevTools";
  Object.assign(titleDiv.style, {
    fontWeight: "700",
    fontSize: "16px",
    color: "#f1f5f9",
    marginBottom: "2px"
  });

  const subtitleDiv = document.createElement("div");
  subtitleDiv.textContent = "Ready to monitor";
  Object.assign(subtitleDiv.style, {
    fontSize: "12px",
    color: "rgba(241, 245, 249, 0.7)"
  });

  textContainer.appendChild(titleDiv);
  textContainer.appendChild(subtitleDiv);
  headerDiv.appendChild(iconContainer);
  headerDiv.appendChild(textContainer);

  // Create instructions section
  const instructionsDiv = document.createElement("div");
  Object.assign(instructionsDiv.style, {
    marginBottom: "20px",
    lineHeight: "1.5",
    background: "rgba(71, 85, 105, 0.3)",
    padding: "16px",
    borderRadius: "12px",
    border: "1px solid rgba(148, 163, 184, 0.2)"
  });

  const instructionTitle = document.createElement("div");
  instructionTitle.style.marginBottom = "12px";
  instructionTitle.style.fontSize = "15px";
  instructionTitle.style.fontWeight = "600";
  instructionTitle.style.color = "#f1f5f9";
  
  const pressText = document.createTextNode("Press ");
  const f12Span = document.createElement("span");
  f12Span.textContent = "F12";
  Object.assign(f12Span.style, {
    background: "#10b981",
    color: "white",
    padding: "4px 8px",
    borderRadius: "6px",
    fontWeight: "700",
    fontSize: "14px",
    boxShadow: "0 2px 4px rgba(16, 185, 129, 0.3)"
  });
  const toOpenText = document.createTextNode(" to open DevTools");
  
  instructionTitle.appendChild(pressText);
  instructionTitle.appendChild(f12Span);
  instructionTitle.appendChild(toOpenText);

  const instructionDesc = document.createElement("div");
  Object.assign(instructionDesc.style, {
    color: "rgba(203, 213, 225, 0.8)",
    fontSize: "13px",
    lineHeight: "1.4"
  });
  
  const lookText = document.createTextNode("Look for the ");
  const strongText = document.createElement("strong");
  strongText.textContent = "WebSocket DevTools";
  strongText.style.color = "#10b981";
  const tabText = document.createTextNode(" tab to start monitoring connections");
  
  instructionDesc.appendChild(lookText);
  instructionDesc.appendChild(strongText);
  instructionDesc.appendChild(tabText);

  instructionsDiv.appendChild(instructionTitle);
  instructionsDiv.appendChild(instructionDesc);

  // Create button section
  const buttonDiv = document.createElement("div");
  Object.assign(buttonDiv.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px"
  });

  const button = document.createElement("button");
  button.className = "ws-hint-button";
  button.textContent = "Got it!";

  buttonDiv.appendChild(button);

  // Assemble all parts
  hintContent.appendChild(headerDiv);
  hintContent.appendChild(instructionsDiv);
  hintContent.appendChild(buttonDiv);
  hint.appendChild(hintContent);

  document.body.appendChild(hint);

  // Enhanced close functionality
  const closeHint = () => {
    if (hint.parentElement) {
      hint.remove();
    }
    // Also remove the style element
    if (style.parentElement) {
      style.remove();
    }
  };

  // Set button click handler
  button.onclick = closeHint;

  // Auto hide after 8 seconds
  setTimeout(closeHint, 8000);
}
