import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import ControlPanel from "../components/ControlPanel.jsx";
import WebSocketList from "../components/WebSocketList.jsx";
import MessageDetails from "../components/MessageDetails.jsx";
import FloatingSimulate from "../components/FloatingSimulate.jsx";
import LanguageSelector from "../components/LanguageSelector.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { useTheme } from "../hooks/useTheme.js";
import { initializeTheme } from "../utils/theme.js";
import ExtensionIcon from "../Icons/ExtensionIcon.jsx";
import { t, addLanguageChangeListener, getCurrentLanguage, initForPanel } from "../utils/i18n.js";
import i18n from "../utils/i18n.js";
import "../styles/main.css";
import { Ban, AlertTriangle } from "lucide-react";

// Performance configuration
const MAX_MESSAGES_PER_CONNECTION = 5000; // Max messages retained per connection
const MAX_TOTAL_MESSAGES = 20000; // Max total messages across all connections
const MAX_PROCESSED_IDS = 50000; // Max processed message IDs to retain

/**
 * Connection details change for every message, while membership changes only when a connection is added or cleared.
 * @param {Map<unknown, unknown>} previousConnections
 * @param {Map<unknown, unknown>} nextConnections
 * @returns {boolean}
 */
const hasSameConnectionIds = (previousConnections, nextConnections) => {
  if (previousConnections.size !== nextConnections.size) return false;
  for (const connectionId of previousConnections.keys()) {
    if (!nextConnections.has(connectionId)) return false;
  }
  return true;
};

const WebSocketPanel = () => {
  const colorScheme = useTheme();
  const [isMonitoring, setIsMonitoring] = useState(true);
  const [blockStatus, setBlockStatus] = useState({
    send: false,
    receive: false
  });
  const [websocketEvents, setWebsocketEvents] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const [currentTabId, setCurrentTabId] = useState(null);

  // Circuit breaker state - for showing banner when high traffic stops monitoring
  const [circuitBreakerTriggered, setCircuitBreakerTriggered] = useState(false);
  const [circuitBreakerRate, setCircuitBreakerRate] = useState(0);

  // Separate connection management and message management
  const [connections, setConnections] = useState(() => ({
    map: new Map(),
    ids: new Set(),
  }));
  const connectionsMap = connections.map; // Basic info for all connections (including active and inactive)
  const connectionIds = connections.ids;

  // Keep the membership Set reference stable when only connection metadata changes.
  const setConnectionsMap = useCallback((updateConnections) => {
    setConnections((previousConnections) => {
      const nextConnections = typeof updateConnections === "function"
        ? updateConnections(previousConnections.map)
        : updateConnections;
      const ids = hasSameConnectionIds(previousConnections.map, nextConnections)
        ? previousConnections.ids
        : new Set(nextConnections.keys());

      return { map: nextConnections, ids };
    });
  }, []);

  // Message deduplication mechanism
  const processedMessageIds = useRef(new Set());

  // Ref for FloatingSimulate component
  const floatingSimulateRef = useRef(null);

  // Language state for triggering re-renders when language changes
  const [currentLanguage, setCurrentLanguage] = useState(() => getCurrentLanguage());

  useEffect(() => {
    // Initialize panel with saved preference priority
    initForPanel();
    
    // Language change listener for re-rendering when language changes
    const unsubscribeLanguage = addLanguageChangeListener((newLanguage) => {
      setCurrentLanguage(newLanguage);
    });

    return () => {
      unsubscribeLanguage();
    };
  }, []);

  useEffect(() => {
    // Get the tab ID that current DevTools is attached to
    const tabId = chrome.devtools.inspectedWindow.tabId;
    setCurrentTabId(tabId);

    // === NEW: Establish persistent connection with background and send tabId ===
    const port = chrome.runtime.connect({ name: "devtools" });
    port.postMessage({ type: "init", tabId });
    window._wsInspectorPort = port; // Keep global reference to prevent GC
    // === END NEW ===

    // Request existing data
    const loadExistingData = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "get-existing-data",
        });

        if (response && response.success) {
          // Sync monitoring state
          if (response.isMonitoring !== undefined) {
            setIsMonitoring(response.isMonitoring);
          }

          // Load existing event data
          if (response.data && response.data.length > 0) {
            // Filter events for current tab
            const tabEvents = response.data.filter(
              (event) => event.tabId === tabId
            );

            // Update connection info
            const newConnectionsMap = new Map();
            tabEvents.forEach((eventData) => {
              if (
                eventData.type === "connection" ||
                eventData.type === "open"
              ) {
                newConnectionsMap.set(eventData.id, {
                  id: eventData.id,
                  url: eventData.url,
                  status:
                    eventData.type === "connection" ? "connecting" : "open",
                  timestamp: eventData.timestamp,
                  lastActivity: eventData.timestamp,
                  frameContext: eventData.frameContext, // Preserve iframe context information
                });
              } else if (
                eventData.type === "close" ||
                eventData.type === "error"
              ) {
                const existing = newConnectionsMap.get(eventData.id);
                newConnectionsMap.set(eventData.id, {
                  id: eventData.id,
                  url: existing?.url || eventData.url || "Unknown URL",
                  status: eventData.type,
                  timestamp: existing?.timestamp || eventData.timestamp,
                  lastActivity: eventData.timestamp,
                  frameContext: existing?.frameContext || eventData.frameContext, // Preserve iframe context information
                });
              } else if (eventData.type === "message") {
                const existing = newConnectionsMap.get(eventData.id);
                if (existing) {
                  newConnectionsMap.set(eventData.id, {
                    ...existing,
                    lastActivity: eventData.timestamp,
                    frameContext: existing.frameContext || eventData.frameContext, // Preserve iframe context information
                  });
                }
              }
            });

            setConnectionsMap(newConnectionsMap);
            setWebsocketEvents(tabEvents);
          }
        }
      } catch (error) {
        console.error("❌ Failed to load existing data:", error);
      }
    };

    // Load existing data
    loadExistingData();

    // Listen to messages from background script
    const messageListener = (message, sender, sendResponse) => {
      // Check if sendResponse is available (runtime message) or not (port message)
      const hasSendResponse = typeof sendResponse === 'function';
      
      // Handle batched events
      if (message.type === "websocket-event-batch") {
        const batchEvents = message.data;
        if (!batchEvents || !Array.isArray(batchEvents)) return;

        // Filter valid events for current tab
        const validEvents = batchEvents.filter(eventData => {
          if (eventData.tabId !== tabId) return false;

          // Deduplication
          if (eventData.messageId && processedMessageIds.current.has(eventData.messageId)) {
            return false;
          }

          if (eventData.messageId) {
            processedMessageIds.current.add(eventData.messageId);
          }

          return true;
        });

        if (validEvents.length === 0) return;

        // Batch update connection info
        setConnectionsMap((prevConnections) => {
          const newConnections = new Map(prevConnections);
          const hadConnections = prevConnections.size > 0;
          let newConnectionIdToSelect = null;

          validEvents.forEach(eventData => {
            // Handle manual connection creation success event
            if (eventData.type === "manual-connection-created") {
               newConnectionIdToSelect = eventData.connectionId;
            }

            if (eventData.type === "connection" || eventData.type === "open") {
              // Create or update connection to active status
              newConnections.set(eventData.id, {
                id: eventData.id,
                url: eventData.url,
                status: eventData.type === "connection" ? "connecting" : "open",
                timestamp: eventData.timestamp,
                lastActivity: eventData.timestamp,
                frameContext: eventData.frameContext,
              });

              // Auto-select logic
              if (!hadConnections && newConnections.size === 1) {
                newConnectionIdToSelect = eventData.id;
              }
            } else if (eventData.type === "close" || eventData.type === "error") {
              // Update connection to inactive status
              const existing = newConnections.get(eventData.id);
              newConnections.set(eventData.id, {
                id: eventData.id,
                url: existing?.url || eventData.url || "Unknown URL",
                status: eventData.type,
                timestamp: existing?.timestamp || eventData.timestamp,
                lastActivity: eventData.timestamp,
                frameContext: existing?.frameContext || eventData.frameContext,
              });
            } else if (eventData.type === "message") {
              // Update last activity
              const existing = newConnections.get(eventData.id);
              if (existing) {
                newConnections.set(eventData.id, {
                  ...existing,
                  lastActivity: eventData.timestamp,
                  frameContext: existing.frameContext || eventData.frameContext,
                });
              }
            }
          });

          // Handle delayed selection
          if (newConnectionIdToSelect) {
            setTimeout(() => {
              setSelectedConnectionId(newConnectionIdToSelect);
            }, 100);
          }

          return newConnections;
        });

        // Batch update events list with capacity limit
        setWebsocketEvents((prevEvents) => {
          const newEvents = [...prevEvents, ...validEvents];
          // Limit total messages to prevent memory overflow
          if (newEvents.length > MAX_TOTAL_MESSAGES) {
            return newEvents.slice(-MAX_TOTAL_MESSAGES);
          }
          return newEvents;
        });

        // Clean up processed message IDs if too large
        if (processedMessageIds.current.size > MAX_PROCESSED_IDS) {
          const idsArray = Array.from(processedMessageIds.current);
          processedMessageIds.current = new Set(idsArray.slice(-MAX_PROCESSED_IDS / 2));
        }

      } else if (message.type === "websocket-event") {
        const eventData = message.data;
        const messageId = message.messageId;

        // Filter: only process events from current tab
        if (eventData.tabId !== tabId) {
          if (hasSendResponse) {
            sendResponse({
              received: true,
              ignored: true,
              messageId,
              reason: "different-tab",
            });
          }
          return;
        }

        // MessageId-based deduplication mechanism
        if (messageId && processedMessageIds.current.has(messageId)) {
          if (hasSendResponse) {
            sendResponse({ received: true, duplicate: true, messageId });
          }
          return;
        }

        // Add to processed set
        if (messageId) {
          processedMessageIds.current.add(messageId);
        }

        // Handle manual connection creation success event
        if (eventData.type === "manual-connection-created") {
          // Delay to ensure connection event is processed
          setTimeout(() => {
            setSelectedConnectionId(eventData.connectionId);
          }, 100);
        }

        // Handle circuit breaker triggered - show banner and update UI
        if (eventData.type === "circuit-breaker-triggered") {
          console.warn(`[WebSocket Proxy Panel] Circuit breaker triggered: ${eventData.messagesPerSecond} msg/s`);

          // Turn off monitoring in UI and show banner
          setIsMonitoring(false);
          setCircuitBreakerTriggered(true);
          setCircuitBreakerRate(eventData.messagesPerSecond || 0);

          if (hasSendResponse) {
            sendResponse({ received: true, messageId });
          }
          return;
        }

        // Update connection info
        setConnectionsMap((prevConnections) => {
          const newConnections = new Map(prevConnections);
          const hadConnections = prevConnections.size > 0;

          if (eventData.type === "connection" || eventData.type === "open") {
            // Create or update connection to active status
            newConnections.set(eventData.id, {
              id: eventData.id,
              url: eventData.url,
              status: eventData.type === "connection" ? "connecting" : "open",
              timestamp: eventData.timestamp,
              lastActivity: eventData.timestamp,
              frameContext: eventData.frameContext, // Preserve iframe context information
            });

            // Auto-select connection: automatically select when transitioning from 0 to 1 connection
            if (!hadConnections && newConnections.size === 1) {
              setTimeout(() => {
                setSelectedConnectionId(eventData.id);
              }, 100);
            }
          } else if (eventData.type === "close" || eventData.type === "error") {
            // Update connection to inactive status, create if connection does not exist
            const existing = newConnections.get(eventData.id);
            newConnections.set(eventData.id, {
              id: eventData.id,
              url: existing?.url || eventData.url || "Unknown URL",
              status: eventData.type, // "close" or "error"
              timestamp: existing?.timestamp || eventData.timestamp,
              lastActivity: eventData.timestamp,
              frameContext: existing?.frameContext || eventData.frameContext, // Preserve iframe context information
            });
          } else if (eventData.type === "message") {
            // Update last activity time (for message events)
            const existing = newConnections.get(eventData.id);
            if (existing) {
              newConnections.set(eventData.id, {
                ...existing,
                lastActivity: eventData.timestamp,
                frameContext: existing.frameContext || eventData.frameContext, // Preserve iframe context information
              });
            }
          }

          return newConnections;
        });

        setWebsocketEvents((prevEvents) => {
          const newEvents = [...prevEvents, eventData];
          // Limit total messages to prevent memory overflow
          if (newEvents.length > MAX_TOTAL_MESSAGES) {
            return newEvents.slice(-MAX_TOTAL_MESSAGES);
          }
          return newEvents;
        });
      } else if (message.type === "page-refresh") {
        const eventData = message.data;
        
        // Filter: only process events from current tab
        if (eventData.tabId !== tabId) {
          if (hasSendResponse) {
            sendResponse({
              received: true,
              ignored: true,
              reason: "different-tab",
            });
          }
          return;
        }

        // Clear all connections and events for this tab
        handleClearConnections();
        
        // Clear processed message IDs
        processedMessageIds.current.clear();
      } else if (message.type === "keep-alive-active") {
        // Handle active keep-alive from page context
        const source = message.data?.source || "unknown";
        console.log(`[WebSocket Proxy] Active keep-alive received from ${source}`);
        
        // Update connection status to show active communication
        // setConnectionStatus("connected"); // This line was removed as per the new_code, as setConnectionStatus is not defined.
      }

      // New: Handle ping/pong for connection health
      if (message.type === "ping") {
        try {
          port.postMessage({ type: "pong", timestamp: Date.now() });
        } catch (error) {
          console.warn("Failed to respond to ping, connection may be broken");
        }
        return;
      }
      
      // New: Handle keep-alive messages
      if (message.type === "keep-alive") {
        // Respond to keep-alive to maintain connection
        try {
          port.postMessage({ type: "keep-alive-ack", timestamp: Date.now() });
        } catch (error) {
          console.warn("Failed to respond to keep-alive, connection may be broken");
        }
        return;
      }

      // Only call sendResponse if it's available
      if (hasSendResponse) {
        sendResponse({ received: true, messageId: message.messageId });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Add port message listener for the connection established earlier
    if (window._wsInspectorPort) {
      window._wsInspectorPort.onMessage.addListener(messageListener);
    }

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      if (window._wsInspectorPort) {
        window._wsInspectorPort.onMessage.removeListener(messageListener);
        // Clean up port reference
        window._wsInspectorPort = null;
      }
      
      // Clean up health check
      if (connectionHealthCheck) {
        clearInterval(connectionHealthCheck);
      }
      
      // Clean up connection check interval
      if (connectionCheckInterval.current) {
        clearInterval(connectionCheckInterval.current);
        connectionCheckInterval.current = null;
      }
      
      // Clean up port connection
      if (port) {
        try {
          port.disconnect();
        } catch (error) {
          // Ignore errors
        }
      }
    };
  }, []);

  const handleStartMonitoring = () => {
    setIsMonitoring(true);

    // Clear circuit breaker banner if showing
    if (circuitBreakerTriggered) {
      setCircuitBreakerTriggered(false);
      setCircuitBreakerRate(0);
    }

    // Send start monitoring message to background script
    chrome.runtime
      .sendMessage({
        type: "start-monitoring",
        tabId: currentTabId,
      })
      .then(() => {})
      .catch((error) => {
        console.error("Failed to start monitoring:", error);
      });
  };

  const handleStopMonitoring = () => {
    setIsMonitoring(false);

    // 发送停止监控消息到 background script
    chrome.runtime
      .sendMessage({
        type: "stop-monitoring",
        tabId: currentTabId,
      })
      .then((response) => {
      })
      .catch((error) => {
        console.error("❌ Failed to stop monitoring:", error);
      });
  };

  const handleClearConnections = () => {
    setWebsocketEvents([]);
    setConnectionsMap(new Map());
    setSelectedConnectionId(null);
  };

  const handleClearMessages = (connectionId) => {
    setWebsocketEvents((prevEvents) => {
      // Remove all events (messages and system events) for the target connection
      return prevEvents.filter((event) => event.id !== connectionId);
    });
    // Basic connection information remains in the connections Map, so the connection will still be displayed in the list
  };

  const handleSelectConnection = (connectionId) => {
    setSelectedConnectionId(connectionId);
  };

  // Generate unique message ID for simulated messages
  const generateMessageId = () => {
    return `msg_simulated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  const handleSimulateMessage = async ({
    connectionId,
    message,
    direction,
  }) => {

    try {
      // 1. Send simulate message to background (for actual simulation execution)
      const response = await chrome.runtime.sendMessage({
        type: "simulate-message",
        data: {
          connectionId,
          message,
          direction,
          tabId: currentTabId, // Include current tab ID
        },
      });

      // 2. Handle simulated message display directly within Panel
      if (response && response.success) {
        const connectionInfo = connectionsMap.get(connectionId);
        const simulatedEvent = {
          id: connectionId,
          url: connectionInfo?.url || "Unknown",
          type: "message",
          data: message,
          direction: direction,
          timestamp: Date.now(),
          status: connectionInfo?.status || "open",
          simulated: true, // Mark as simulated message
          messageId: generateMessageId(), // Add messageId for new message highlight
        };

        // Add directly to the event list
        setWebsocketEvents((prevEvents) => [simulatedEvent, ...prevEvents]);

      }

      return response;
    } catch (error) {
      throw error;
    }
  };

  // Get all messages and events for the selected connection
  const getSelectedConnectionData = () => {
    if (!selectedConnectionId) return null;

    // Get basic connection info from connectionsMap
    const connectionInfo = connectionsMap.get(selectedConnectionId);
    if (!connectionInfo) return null;

    // Get all events/messages for this connection
    const connectionMessages = websocketEvents.filter(
      (event) => event.id === selectedConnectionId
    );

    return {
      id: selectedConnectionId,
      url: connectionInfo.url,
      messages: connectionMessages,
    };
  };

  // Handle opening SimulateMessagePanel
  const handleOpenSimulatePanel = (options = {}) => {

    if (floatingSimulateRef.current) {
      floatingSimulateRef.current.openPanel(options);
    } else {
    }
  };

  // Handle manual WebSocket connection
  const handleManualConnect = async (wsUrl) => {
    
    try {
      // Set a Promise to wait for the manual-connection-created event
      const connectionCreatedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection creation timeout"));
        }, 10000); // 10 second timeout

        const listener = (message, sender, sendResponse) => {
          if (message.type === "websocket-event" && 
              message.data.type === "manual-connection-created" &&
              message.data.url === wsUrl) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);
            resolve(message.data.connectionId);
          } else if (message.type === "websocket-event" && 
                     message.data.type === "manual-connection-error" &&
                     message.data.url === wsUrl) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);
            reject(new Error(message.data.error || "Manual connection failed"));
          }
          
          // Always respond to keep the message channel open
          if (typeof sendResponse === 'function') {
            sendResponse({ received: true });
          }
        };

        chrome.runtime.onMessage.addListener(listener);
      });

      // Send message to background script to create WebSocket connection in current tab
      const response = await chrome.runtime.sendMessage({
        type: "create-manual-websocket",
        data: {
          url: wsUrl,
          tabId: currentTabId,
        },
      });

      if (response && response.success) {
        // Wait for actual connection creation event
        const connectionId = await connectionCreatedPromise;
        return { success: true, connectionId };
      } else {
        throw new Error(response?.error || "Failed to create manual connection");
      }
    } catch (error) {
      throw error;
    }
  };

  // Get block status display text
  const getBlockStatusText = () => {
    const { send, receive } = blockStatus;
    if (!send && !receive) return null;
    if (send && receive) return t("panel.header.block_all");
    if (send) return t("panel.header.block_send");
    if (receive) return t("panel.header.block_receive");
  };

  // Handle interception status change
  const handleBlockChange = (type, enabled) => {
    setBlockStatus(prev => ({
      ...prev,
      [type]: enabled
    }));
  };

  // Set connection status to closing
  const handleSetConnectionClosing = (connectionId) => {
    setConnectionsMap((prevConnections) => {
      const newConnections = new Map(prevConnections);
      const existing = newConnections.get(connectionId);
      if (existing) {
        newConnections.set(connectionId, {
          ...existing,
          status: "closing",
        });
      }
      return newConnections;
    });
  };

  const selectedConnection = getSelectedConnectionData();

  // Show loading while i18n initializes


  // Keep Mantine components aligned with the extension-wide preference.
  return (
    <MantineProvider forceColorScheme={colorScheme}>
      <div className="websocket-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            {isMonitoring ? (
              <span className="status active">{t("panel.header.status_active")}</span>
            ) : (
              <span className="status inactive">{t("panel.header.status_inactive")}</span>
            )}

            {isMonitoring && getBlockStatusText() && (
              <span className="websocket-panel-block-status-label">
                <Ban size={12} />
                <span>{getBlockStatusText()}</span>
              </span>
            )}
          </div>
          <div className="panel-status">
            <ThemeToggle />
            <LanguageSelector />
            <button 
              className="extension-icon-panel"
              onClick={() => {
                chrome.tabs.create({ url: "https://websocket-devtools.com" });
              }}
              style={{
                marginLeft: '8px',
                padding: '2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
                border: '0px solid rgba(148, 163, 184, 0.2)',
                background: 'rgba(71, 85, 105, 0.1)',
                outline: 'none',
              }}
            >
              <ExtensionIcon 
                size={20}
                // backgroundColor="rgba(71, 85, 105, 0.6)"
                // primaryColor="#10b981"
                // accentColor="#fbbf24"
                // secondaryColor="#047857"
              />
            </button>
          </div>
        </div>

        {/* Circuit Breaker Warning Banner */}
        {circuitBreakerTriggered && (
          <div className="traffic-pause-banner">
            <div className="traffic-pause-content">
              <AlertTriangle size={18} className="traffic-pause-icon" />
              <div className="traffic-pause-text">
                <span className="traffic-pause-title">
                  {t("panel.circuitBreaker.title") || "High Traffic Detected"}
                </span>
                <span className="traffic-pause-description">
                  {t("panel.circuitBreaker.description", { rate: circuitBreakerRate }) ||
                   `Monitoring stopped due to high traffic (${circuitBreakerRate} msg/s). Click Monitor to resume.`}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="panel-content-fixed">
          {/* 左侧固定宽度布局：ControlPanel + WebSocketList */}
          <div className="panel-left-section-fixed">
            <div className="control-panel-container-fixed">
              <div className="panel-wrapper">
                <div className="panel-body">
                  <ControlPanel
                    isMonitoring={isMonitoring}
                    onStartMonitoring={handleStartMonitoring}
                    onStopMonitoring={handleStopMonitoring}
                    onBlockChange={handleBlockChange}
                    currentTabId={currentTabId}
                  />
                </div>
              </div>
            </div>

            <div className="websocket-list-container-fixed">
              <div className="panel-wrapper">
                <div className="panel-body">
                  <WebSocketList
                    websocketEvents={websocketEvents}
                    connectionsMap={connectionsMap}
                    selectedConnectionId={selectedConnectionId}
                    onSelectConnection={handleSelectConnection}
                    onClearConnections={handleClearConnections}
                    onManualConnect={handleManualConnect}
                    onSetConnectionClosing={handleSetConnectionClosing}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="panel-resize-handle vertical disabled" />

          {/* 右侧：MessageDetails */}
          <div className="panel-right-section-fixed">
            <div className="panel-wrapper">
              <div className="panel-body">
                <MessageDetails
                  connection={selectedConnection}
                  selectedConnectionId={selectedConnectionId} // 传递连接ID用于详情面板重新渲染
                  connectionIds={connectionIds}
                  onSimulateMessage={handleSimulateMessage}
                  onClearMessages={handleClearMessages}
                  onOpenSimulatePanel={handleOpenSimulatePanel}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 悬浮模拟消息窗口 */}
        <FloatingSimulate
          ref={floatingSimulateRef}
          connection={selectedConnection}
          onSimulateMessage={handleSimulateMessage}
          onManualConnect={handleManualConnect}
        />
      </div>
    </MantineProvider>
  );
};

// 渲染到 DOM
const container = document.getElementById("root");
const root = createRoot(container);
initializeTheme().then(() => root.render(<WebSocketPanel />));
