import React, { useState, useEffect, useMemo, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { filterMessages } from "../utils/filterUtils";
import JsonViewer from "./JsonViewer";
import useNewMessageHighlight from "../hooks/useNewMessageHighlight";
import { addFromMessageList } from "../utils/globalFavorites";
import {
  Ban,
  Search,
  Settings,
  CircleX,
  ListTree,
  Columns2,
  Rows2,
} from "lucide-react";
import { getCurrentLanguage, t } from "../utils/i18n.js";
import {
  buildMessageSections,
  createMessageGroupingCache,
} from "../utils/messageGrouping.js";
import CheeseIcon from "../Icons/Cheese.jsx";
import ProtobufIcon from "../Icons/Protobuf.jsx";
import MessageProjectionControls from "./MessageProjectionControls.jsx";
import MessageProjectionValue from "./MessageProjectionValue.jsx";
import {
  createMessageProjectionCache,
  buildProjectedSections,
  getProjectedMessages,
  getVisibleProjectedMessages,
  parseProjectionPath,
} from "../utils/messageProjection.js";

// SVG icon components
const Icons = {
  ArrowUp: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2L10 6H8V10H4V6H2L6 2Z" fill="currentColor" />
    </svg>
  ),
  ArrowDown: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 10L2 6H4V2H8V6H10L6 10Z" fill="currentColor" />
    </svg>
  ),
  Connection: () => (
    < Settings size={12} />
  ),
  Simulate: () => (
    <CheeseIcon width={14} height={14} color="black" spotColor="black"/>
  ),
  Simulate2: () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path
        d="M6 1L7.5 4H10.5L8.25 6L9 9L6 7.5L3 9L3.75 6L1.5 4H4.5L6 1Z"
        fill="currentColor"
      />
    </svg>
  ),
  Block: () => (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <circle
        cx="6"
        cy="6"
        r="5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M3 3L9 9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Protobuf: () => (
    <ProtobufIcon size={12} />
  ),
  Star: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M6 1L7.5 4H10.5L8.25 6L9 9L6 7.5L3 9L3.75 6L1.5 4H4.5L6 1Z"
        fill="currentColor"
      />
    </svg>
  ),
};

const DEFAULT_PROJECTION_CONFIG = Object.freeze({
  mode: "raw",
  path: "",
  hideMissing: true,
  hideEmpty: true,
});

const MessageDetails = ({
  connection,
  selectedConnectionId,
  isIntercepting,
  onSimulateMessage,
  onClearMessages,
  onOpenSimulatePanel,
  connectionIds,
}) => {
  const [filterDirection, setFilterDirection] = useState("all"); // 'all' | 'outgoing' | 'incoming'
  const [filterText, setFilterText] = useState(""); // Message content filter
  const [filterInvert, setFilterInvert] = useState(false); // Invert filter
  const [selectedMessageKey, setSelectedMessageKey] = useState(null); // Selected message
  const [copiedMessageKey, setCopiedMessageKey] = useState(null); // Copied message key
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' | 'desc' time sorting
  // Split layout direction: 'vertical' (list on top, detail below) | 'horizontal' (list left, detail right)
  const [layoutDirection, setLayoutDirection] = useState(() => {
    try {
      return localStorage.getItem("websocket-message-layout") === "horizontal"
        ? "horizontal"
        : "vertical";
    } catch {
      return "vertical";
    }
  });
  const [groupEnabled, setGroupEnabled] = useState(false);
  const [groupField, setGroupField] = useState("requestID");
  const [groupValue, setGroupValue] = useState("");
  const [groupDisplayField, setGroupDisplayField] = useState("");
  const [groupSortMode, setGroupSortMode] = useState("firstOutgoing");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const groupingCacheRef = useRef(createMessageGroupingCache());
  const projectionCacheRef = useRef(createMessageProjectionCache());
  const projectionConfigsRef = useRef(new Map());
  const rowKeysRef = useRef(new WeakMap());
  const nextRowKeyRef = useRef(0);
  const [projectionConfig, setProjectionConfig] = useState({
    ...DEFAULT_PROJECTION_CONFIG,
    connectionId: null,
  });
  // Read the next connection's saved config immediately instead of showing the previous connection's fields for one paint.
  const activeProjectionConfig = projectionConfig.connectionId === selectedConnectionId
    ? projectionConfig
    : projectionConfigsRef.current.get(selectedConnectionId) || DEFAULT_PROJECTION_CONFIG;
  // This prop invalidates memoized field labels after the panel switches language.
  const currentLocale = getCurrentLanguage();
  const sortedMessages = useMemo(() => {
    const filteredMessages = filterMessages(connection?.messages || [], {
      direction: filterDirection,
      text: filterText,
      invert: filterInvert,
    });

    return [...filteredMessages].sort((a, b) => {
      return sortOrder === "desc"
        ? b.timestamp - a.timestamp
        : a.timestamp - b.timestamp;
    });
  }, [
    connection?.messages,
    filterDirection,
    filterText,
    filterInvert,
    sortOrder,
  ]);
  const candidateMessages = useMemo(() => {
    if (activeProjectionConfig.mode !== "field") return [];
    const recentMessages = (connection?.messages || []).slice(-50).reverse();
    if (!selectedMessageKey || recentMessages.some((message) => message.messageId === selectedMessageKey)) {
      return recentMessages;
    }
    const selectedMessage = sortedMessages.find((message) => message.messageId === selectedMessageKey);
    return selectedMessage ? [selectedMessage, ...recentMessages] : recentMessages;
  }, [activeProjectionConfig.mode, connection?.messages, selectedMessageKey, sortedMessages]);

  const groupOtherTitle = t("messageDetails.grouping.other");
  const missingGroupFieldTitle = t("messageDetails.grouping.noField", {
    field: groupField.trim(),
  });
  // UI-only state changes such as hover or collapse reuse the same sections.
  const messageSections = useMemo(
    () =>
      buildMessageSections({
        sortedMessages,
        groupEnabled,
        groupField,
        groupValue,
        groupDisplayField,
        groupSortMode,
        otherTitle: groupOtherTitle,
        missingFieldTitle: missingGroupFieldTitle,
        cache: groupingCacheRef.current,
      }),
    [
      sortedMessages,
      groupEnabled,
      groupField,
      groupValue,
      groupDisplayField,
      groupSortMode,
      groupOtherTitle,
      missingGroupFieldTitle,
    ]
  );

  const projectionPath = useMemo(
    () => parseProjectionPath(activeProjectionConfig.path),
    [activeProjectionConfig.path]
  );
  const projectionTokens = projectionPath.ok ? projectionPath.tokens : null;
  const projectedSections = useMemo(
    () => buildProjectedSections(messageSections, activeProjectionConfig, projectionTokens, projectionCacheRef.current),
    [activeProjectionConfig, messageSections, projectionTokens]
  );
  // Detail selection remains available when its group is collapsed.
  const projectedMessages = useMemo(
    () => getProjectedMessages(projectedSections),
    [projectedSections]
  );

  const visibleMessages = useMemo(
    () => getVisibleProjectedMessages(projectedSections, collapsedGroups),
    [projectedSections, collapsedGroups]
  );

  const updateProjectionConfig = (patch) => {
    setProjectionConfig((previous) => {
      const next = { ...previous, ...patch, connectionId: selectedConnectionId };
      if (selectedConnectionId) projectionConfigsRef.current.set(selectedConnectionId, next);
      return next;
    });
  };

  
  // Use new message highlight hook
  const { isNewMessage, clearHighlights } = useNewMessageHighlight(
    connection,
    500
  );
  
  // Reset selected message when connection switches, close detail panel, clear new message highlights
  useEffect(() => {
    setSelectedMessageKey(null);
    clearHighlights();
    setProjectionConfig(
      projectionConfigsRef.current.get(selectedConnectionId) || {
        ...DEFAULT_PROJECTION_CONFIG,
        connectionId: selectedConnectionId,
      }
    );
  }, [selectedConnectionId, clearHighlights]);

  useEffect(() => {
    if (!connectionIds) return;
    for (const connectionId of projectionConfigsRef.current.keys()) {
      if (!connectionIds.has(connectionId)) projectionConfigsRef.current.delete(connectionId);
    }
  }, [connectionIds]);

  useEffect(() => {
    if (selectedMessageKey && !projectedMessages.some((message) => message.messageId === selectedMessageKey)) {
      setSelectedMessageKey(null);
    }
  }, [projectedMessages, selectedMessageKey]);

  // Keyboard navigation for message selection
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle arrow keys when there are visible messages
      if (visibleMessages.length === 0) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName))) return;
      
      const tableContainer = document.querySelector('.messages-table-container');
      const isTableFocused = tableContainer && document.activeElement === tableContainer;
      const hasSelectedMessage = selectedMessageKey !== null;
      
      // Handle arrow keys if table is focused OR if we have a selected message
      if ((isTableFocused || hasSelectedMessage) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        
        const currentIndex = selectedMessageKey 
          ? visibleMessages.findIndex(msg => msg.messageId === selectedMessageKey)
          : -1;
        
        let newIndex;
        if (currentIndex === -1) {
          // No message selected, select first message
          newIndex = 0;
        } else if (e.key === 'ArrowUp') {
          newIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
        } else {
          newIndex = currentIndex < visibleMessages.length - 1 ? currentIndex + 1 : currentIndex;
        }
        
        if (newIndex >= 0 && newIndex < visibleMessages.length) {
          const newMessageKey = visibleMessages[newIndex].messageId;
          setSelectedMessageKey(newMessageKey);
          
          // Scroll the selected row into view
          setTimeout(() => {
            const rowElement = document.querySelector(`tr[data-message-id="${newMessageKey}"]`);
            const tableContainer = document.querySelector('.messages-table-container');
            
            if (rowElement && tableContainer) {
              const containerRect = tableContainer.getBoundingClientRect();
              const rowRect = rowElement.getBoundingClientRect();
              
              // Check if row is visible in container
              const isRowVisible = rowRect.top >= containerRect.top && 
                                   rowRect.bottom <= containerRect.bottom;
              
              if (!isRowVisible) {
                rowElement.scrollIntoView({ 
                  behavior: 'smooth', 
                  block: 'nearest',
                  inline: 'nearest'
                });
              }
            }
          }, 0);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visibleMessages, selectedMessageKey]);

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const timeString = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const milliseconds = date.getMilliseconds().toString().padStart(3, "0");
    return `${timeString}.${milliseconds.substring(0, 3)}`;
  };

  if (!connection) {
    return (
      <div className="message-details">
        <div className="empty-state">
          <p>{t("messageDetails.emptyState.selectConnection")}</p>
        </div>
      </div>
    );
  }

  // formatMessage function has been moved to the JsonViewer component for internal handling

  const handleMessageClick = (messageKey) => {
    setSelectedMessageKey(
      selectedMessageKey === messageKey ? null : messageKey
    );
  };

  const handleSortToggle = () => {
    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
  };

  // Toggle between vertical (top/bottom) and horizontal (left/right) split layout
  const handleToggleLayout = () => {
    setLayoutDirection((prev) => {
      const next = prev === "vertical" ? "horizontal" : "vertical";
      try {
        localStorage.setItem("websocket-message-layout", next);
      } catch {
        // ignore persistence failures (e.g. storage disabled)
      }
      return next;
    });
  };

  const truncateMessage = (message, maxLength = 120) => {
    let displayText;
    
    // For protobuf messages, prefer decoded data for display in table
    if (message && message.isProtobuf && message.protobufDecoded) {
      displayText = message.protobufDecoded;
    } else {
      // For non-protobuf messages, use message.data
      displayText = message && message.data ? message.data : message;
    }
    
    // Handle different data types properly
    if (typeof displayText !== "string") {
      if (displayText instanceof ArrayBuffer) {
        // Convert ArrayBuffer to hex string for display
        const bytes = new Uint8Array(displayText);
        displayText = `[Binary ${bytes.length} bytes]: ${Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}${bytes.length > 8 ? '...' : ''}`;
      } else if (displayText instanceof Uint8Array) {
        // Convert Uint8Array to hex string for display
        displayText = `[Binary ${displayText.length} bytes]: ${Array.from(displayText.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}${displayText.length > 8 ? '...' : ''}`;
      } else if (displayText instanceof Blob) {
        displayText = `[Blob ${displayText.size} bytes]`;
      } else if (typeof displayText === 'object' && displayText !== null) {
        try {
          displayText = JSON.stringify(displayText, null, 2);
        } catch (e) {
          displayText = String(displayText);
        }
      } else {
        displayText = String(displayText);
      }
    }
    
    displayText = displayText.replace(/\s+/g, " ").trim();
    if (displayText.length <= maxLength) return displayText;
    return displayText.substring(0, maxLength) + "...";
  };

  const getMessageLength = (message) => {
    if (message.type !== "message") return "-";
    return message.data ? message.data.length : 0;
  };

  const toggleGroupCollapse = (groupId) => {
    setCollapsedGroups((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }));
  };

  // Copy message content to clipboard
  const handleCopyMessage = async (messageData, messageKey) => {
    try {
      // messageData is now a formatted string (from JsonViewer)
      const textToCopy = messageData;
      await navigator.clipboard.writeText(textToCopy);
      setCopiedMessageKey(messageKey);
      setTimeout(() => {
        setCopiedMessageKey(null);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy message:", error);
      try {
        const textArea = document.createElement("textarea");
        textArea.value = messageData;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopiedMessageKey(messageKey);
        setTimeout(() => {
          setCopiedMessageKey(null);
        }, 2000);
      } catch (fallbackError) {
        console.error("Fallback copy also failed:", fallbackError);
      }
    }
  };

  // Add to favorites from JsonViewer (open Simulate panel's favorites tab)
  const handleAddToFavoritesFromViewer = (data) => {
    if (!data || !data.trim()) {
      console.warn("Cannot add to favorites: data is empty");
      return;
    }

    // Open SimulateMessagePanel's favorites tab and create new favorite
    if (onOpenSimulatePanel) {
      onOpenSimulatePanel({
        tab: "favorites",
        data: data,
      });
    } else {
      console.warn("📋 MessageDetails: onOpenSimulatePanel not available");
    }
  };

  const handleClearSearchFilter = () => {
    setFilterText("");
    setFilterInvert(false);
  };

  const handleClearMessagesList = () => {
    if (!connection || !onClearMessages) return;
    onClearMessages(connection.id);
    setSelectedMessageKey(null);
    clearHighlights(); // Clear any remaining highlights
  };

  const getSelectedMessage = () => {
    if (!selectedMessageKey) return null;
    return projectedMessages.find((msg) => {
      return msg.messageId === selectedMessageKey;
    });
  };

  const getStableMessageKey = (message) => {
    if (message.messageId) return message.messageId;
    const existing = rowKeysRef.current.get(message);
    if (existing) return existing;
    const next = `message-row-${nextRowKeyRef.current}`;
    nextRowKeyRef.current += 1;
    rowKeysRef.current.set(message, next);
    return next;
  };

  const renderDataCell = (message, projectionResult) => {
    const isSystemMessage = message.type !== "message";
    const tags = [];

    if (message.simulated) {
      tags.push(
        <span
          key="simulated"
          className="message-tag simulated"
          title={t("messageDetails.tooltips.simulatedMessage")}
        >
          <Icons.Simulate />
          <span>{t("messageDetails.tags.simulate")}</span>
        </span>
      );
    }
    if (message.blocked) {
      tags.push(
        <span
          key="blocked"
          className="message-tag blocked"
          title={message.reason || t("messageDetails.tooltips.messageBlocked")}
        >
          <Icons.Block />
          <span>{t("messageDetails.tags.block")}</span>
        </span>
      );
    }
    if (message.isProtobuf) {
      tags.push(
        <span
          key="protobuf"
          className="message-tag protobuf"
          title={message.protobufError ? `Protobuf detected but decoding failed: ${message.protobufError}` : "Protocol Buffers message detected and decoded"}
        >
          <Icons.Protobuf />
          <span>{t("common.binary")}</span>
        </span>
      );
    }

    if (activeProjectionConfig.mode === "field" && !isSystemMessage) {
      return (
        <div className="data-cell message-projection-cell">
          {!isSystemMessage && (
            <span className={`direction-arrow ${message.direction}`}>
              {message.direction === "outgoing" ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
            </span>
          )}
          {tags.length > 0 && <span className="message-tags">{tags}</span>}
          <MessageProjectionValue result={projectionResult} locale={currentLocale} />
        </div>
      );
    }

    if (isSystemMessage) {
      return (
        <div className="data-cell system">
          <Icons.Connection className="system-icon" style={{flexShrink: 0}}/>
          {tags.length > 0 && <span className="message-tags">{tags}</span>}
          <span className="system-text">
            {message.type === "open"
              ? t("messageDetails.connection.requestServed", { data: message.data || "WebSocket" })
              : message.type === "close"
              ? t("messageDetails.connection.disconnected", { url: message.url || "WebSocket" })
              : message.type === "error"
              ? t("messageDetails.connection.connectionError")
              : message.type}
          </span>
        </div>
      );
    }

    return (
      <div className="data-cell">
        <span className={`direction-arrow ${message.direction}`}>
          {message.direction === "outgoing" ? (
            <Icons.ArrowUp />
          ) : (
            <Icons.ArrowDown />
          )}
        </span>
        {tags.length > 0 && <span className="message-tags">{tags}</span>}
        <span className="message-text">{truncateMessage(message)}</span>
      </div>
    );
  };

  const renderMessageRow = (message, projectionResult) => {
    const messageKey = message.messageId;
    const isSelected = selectedMessageKey === messageKey;
    const isNewMsg = isNewMessage(messageKey);

    return (
      <tr
        key={getStableMessageKey(message)}
        data-message-id={messageKey}
        className={`message-row ${message.direction} ${message.simulated ? "simulated" : ""} ${
          message.blocked ? "blocked" : ""
        } ${isSelected ? "selected" : ""} ${isNewMsg ? "new-message" : ""}`}
        onClick={() => handleMessageClick(messageKey)}
      >
        <td className="col-data">
          <div className="data-cell-wrapper">{renderDataCell(message, projectionResult)}</div>
        </td>
        <td className="col-length">{getMessageLength(message)}</td>
        <td className="col-time">{formatTimestamp(message.timestamp)}</td>
      </tr>
    );
  };

  const isHorizontal = layoutDirection === "horizontal";

  // Resolve the selected message within the currently visible (filtered) list.
  // When the active filter hides it, this is null and the detail panel must stay closed.
  const selectedMessage = getSelectedMessage();

  // Detail panel visual style adapts to split direction (shadow/rounded corners face the list)
  const detailPanelStyle = isHorizontal
    ? {
        boxShadow: "var(--detail-shadow-horizontal, rgba(21, 21, 21, 0.81) -5px 0px 20px 20px)",
        borderTopLeftRadius: "20px",
        borderBottomLeftRadius: "20px",
      }
    : {
        boxShadow: "var(--detail-shadow-vertical, rgba(21, 21, 21, 0.81) 0px -5px 20px 20px)",
        borderTopLeftRadius: "20px",
        borderTopRightRadius: "20px",
      };

  const resizeHandleClass = `panel-resize-handle ${
    isHorizontal ? "vertical" : "horizontal"
  } message-detail-resize-handle`;

  return (
    <div className="message-details">
      <div className="messages-container">
        <PanelGroup direction={layoutDirection}>
          <Panel
            defaultSize={
              selectedMessage ? (isHorizontal ? 55 : 70) : 100
            }
            minSize={5}
          >
            <div className="message-list-pane">
              <div className="details-header">
                <div className="connection-info">
                  <span className="connection-badge" title={connection.url}>{connection.url}</span>
                </div>
                <div className="controls">
                  <div className="control-row">
                    <div className="filter-controls direction-filter">
                      <select value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)}>
                        <option value="all">{t("messageDetails.controls.all")}</option>
                        <option value="outgoing">{t("messageDetails.controls.send")}</option>
                        <option value="incoming">{t("messageDetails.controls.receive")}</option>
                      </select>
                    </div>
                    <div className="filter-controls search-filter">
                      <div className="filter-input-container">
                        <span className="filter-icon">
                          <Search size={12} />
                        </span>
                        <input
                          type="text"
                          value={filterText}
                          onChange={(e) => setFilterText(e.target.value)}
                          placeholder={t("messageDetails.controls.filterPlaceholder")}
                          title={t("messageDetails.projection.searchRawTooltip")}
                        />
                        {filterText && (
                          <button className="clear-filter-btn" onClick={handleClearSearchFilter}>
                            <CircleX size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <label className="invert-checkbox">
                      <input type="checkbox" checked={filterInvert} onChange={(e) => setFilterInvert(e.target.checked)} />
                      <span className="checkmark"></span>
                      <span className="checkbox-label">{t("messageDetails.controls.invert")}</span>
                    </label>
                    <button
                      className="layout-toggle-btn"
                      onClick={handleToggleLayout}
                      title={
                        isHorizontal
                          ? t("messageDetails.controls.verticalLayout")
                          : t("messageDetails.controls.horizontalLayout")
                      }
                    >
                      {isHorizontal ? <Rows2 size={14} /> : <Columns2 size={14} />}
                    </button>
                    <button
                      className="clear-messages-btn"
                      onClick={handleClearMessagesList}
                      disabled={!connection || !connection.messages || connection.messages.length === 0}
                      title={t("messageDetails.controls.clearMessages")}
                    >
                      <Ban size={14} />
                    </button>
                  </div>
                  <div className="control-row group-control-row">
                    <label className="invert-checkbox group-enable-checkbox" title={t("messageDetails.grouping.tooltip")}>
                      <input type="checkbox" checked={groupEnabled} onChange={(e) => setGroupEnabled(e.target.checked)} />
                      <span className="checkmark"></span>
                      <span className="checkbox-label group-checkbox-label">
                        <ListTree size={12} />
                        {t("messageDetails.grouping.enable")}
                      </span>
                    </label>
                    <div className="filter-controls group-field-filter">
                      <label>{t("messageDetails.grouping.field")}</label>
                      <input
                        type="text"
                        value={groupField}
                        onChange={(e) => setGroupField(e.target.value)}
                        placeholder="requestID"
                        disabled={!groupEnabled}
                      />
                    </div>
                    <div className="filter-controls group-value-filter">
                      <label>{t("messageDetails.grouping.value")}</label>
                      <input
                        type="text"
                        value={groupValue}
                        onChange={(e) => setGroupValue(e.target.value)}
                        placeholder="1000002"
                        disabled={!groupEnabled}
                      />
                    </div>
                    <div className="filter-controls group-display-field-filter">
                      <label>{t("messageDetails.grouping.displayField")}</label>
                      <input
                        type="text"
                        value={groupDisplayField}
                        onChange={(e) => setGroupDisplayField(e.target.value)}
                        placeholder="eventID"
                        disabled={!groupEnabled}
                      />
                    </div>
                    <div className="filter-controls group-sort-filter">
                      <label>{t("messageDetails.grouping.sort")}</label>
                      <select
                        value={groupSortMode}
                        onChange={(e) => setGroupSortMode(e.target.value)}
                        disabled={!groupEnabled}
                      >
                        <option value="firstOutgoing">{t("messageDetails.grouping.sort.firstOutgoing")}</option>
                        <option value="firstMessage">{t("messageDetails.grouping.sort.firstMessage")}</option>
                        <option value="latestMessage">{t("messageDetails.grouping.sort.latestMessage")}</option>
                        <option value="groupValue">{t("messageDetails.grouping.sort.groupValue")}</option>
                        <option value="messageCount">{t("messageDetails.grouping.sort.messageCount")}</option>
                      </select>
                    </div>
                    {groupEnabled && (
                      <span className="group-help-text">{t("messageDetails.grouping.emptyValueHint")}</span>
                    )}
                  </div>
                  <MessageProjectionControls
                    key={selectedConnectionId || "no-connection"}
                    config={activeProjectionConfig}
                    messages={candidateMessages}
                    cache={projectionCacheRef.current}
                    onChange={updateProjectionConfig}
                  />
                  {activeProjectionConfig.mode === "field" && (
                    <span className="projection-count">
                      {t("messageDetails.projection.count", {
                        visible: visibleMessages.length,
                        total: sortedMessages.length,
                      })}
                    </span>
                  )}
                </div>
              </div>

              {sortedMessages.length === 0 ? (
                <div className="empty-state">
                  <p>{t("messageDetails.emptyState.noMessages")}</p>
                </div>
              ) : projectedSections.length === 0 ? (
                <div className="empty-state projection-empty-state">
                  <p>{t("messageDetails.projection.noVisibleValues")}</p>
                  <button type="button" onClick={() => updateProjectionConfig({ hideMissing: false, hideEmpty: false })}>
                    {t("messageDetails.projection.showAll")}
                  </button>
                  <button type="button" onClick={() => updateProjectionConfig({ mode: "raw" })}>
                    {t("messageDetails.projection.restoreRaw")}
                  </button>
                </div>
              ) : (
                <div
                  className="messages-table-container"
                  tabIndex={0}
                  style={{ outline: 'none' }}
                >
                  <table className="ws-messages-table">
                  <thead>
                    <tr>
                      <th className="col-data">{activeProjectionConfig.mode === "field" ? t("messageDetails.projection.value") : t("messageDetails.table.data")}</th>
                      <th className="col-length" title={t("messageDetails.projection.lengthTooltip")}>{t("messageDetails.table.length")}</th>
                      <th className="col-time" onClick={handleSortToggle} style={{ cursor: "pointer" }}>
                        {t("messageDetails.table.time")} {sortOrder === "desc" ? "▼" : "▲"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectedSections.map((section) => (
                      <React.Fragment key={section.id}>
                        {section.isGrouped && (
                          <tr className="message-group-row">
                            <td colSpan={3}>
                              <button
                                className="message-group-header"
                                onClick={() => toggleGroupCollapse(section.id)}
                              >
                                <span className={`message-group-arrow ${collapsedGroups[section.id] ? "collapsed" : ""}`} />
                                <span className="message-group-title">{section.title}</span>
                                {section.displayValue && (
                                  <span className="message-group-display-value">{section.displayValue}</span>
                                )}
                                <span className="message-group-count">
                                  {activeProjectionConfig.mode === "field"
                                    ? `${section.projectedMessages.length} / ${section.messages.length}`
                                    : section.messages.length}
                                </span>
                              </button>
                            </td>
                          </tr>
                        )}
                        {(!section.isGrouped || !collapsedGroups[section.id]) &&
                          section.projectedMessages.map(({ message, result }) =>
                            renderMessageRow(message, result)
                          )}
                      </React.Fragment>
                    ))}
                  </tbody>
                    </table>
                  </div>
                )}
            </div>
          </Panel>

          {selectedMessage && (
              <>
                <PanelResizeHandle className={resizeHandleClass} />
                <Panel
                  defaultSize={isHorizontal ? 45 : 50}
                  minSize={10}
                  maxSize={95}
                  style={detailPanelStyle}
                >
                  <div className="message-detail-simple" key={selectedConnectionId}>
                    <div className="detail-content">
                      {(() => {
                        const messageKey = selectedMessageKey;
                        return (
                          // <div className="detail-body">
                          <>
                            {/* <div className="detail-actions">
                              <button
                                className="close-btn"
                                onClick={() => setSelectedMessageKey(null)}
                              >
                                ✕
                              </button>
                            </div> */}
                            <JsonViewer
                              data={selectedMessage.data}
                              message={selectedMessage}
                              className="compact"
                              showControls={true}
                              onCopy={(data) => handleCopyMessage(data, messageKey)}
                              copyButtonText="📋 Copy"
                              copiedText="✓ Copied"
                              isCopied={copiedMessageKey === messageKey}
                              showFavoritesButton={true}
                              onAddToFavorites={handleAddToFavoritesFromViewer}
                              onSimulate={(data) => {
                                if (onOpenSimulatePanel) {
                                  onOpenSimulatePanel({
                                    tab: "editor",
                                    data: data,
                                  });
                                }
                              }}
                            />
                            {isIntercepting && (
                              <div className="intercept-actions">
                                <button className="action-btn edit">{t("messageDetails.actions.edit")}</button>
                                <button className="action-btn allow">{t("messageDetails.actions.allow")}</button>
                                <button className="action-btn block">{t("messageDetails.actions.block")}</button>
                              </div>
                            )}
                            {/* </div> */}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </Panel>
              </>
            )}
        </PanelGroup>
      </div>
    </div>
  );
};

export default MessageDetails;
