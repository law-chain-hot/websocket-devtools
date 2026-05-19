import React, { useState, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { filterMessages } from "../utils/filterUtils";
import JsonViewer from "./JsonViewer";
import useNewMessageHighlight from "../hooks/useNewMessageHighlight";
import { addFromMessageList } from "../utils/globalFavorites";
import { Ban, Search, Settings, CircleX, ListTree } from "lucide-react";
import { t } from "../utils/i18n.js";
import CheeseIcon from "../Icons/cheese.jsx";
import ProtobufIcon from "../Icons/Protobuf.jsx";

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

const MessageDetails = ({
  connection,
  selectedConnectionId,
  isIntercepting,
  onSimulateMessage,
  onClearMessages,
  onOpenSimulatePanel,
}) => {
  const [filterDirection, setFilterDirection] = useState("all"); // 'all' | 'outgoing' | 'incoming'
  const [filterText, setFilterText] = useState(""); // Message content filter
  const [filterInvert, setFilterInvert] = useState(false); // Invert filter
  const [selectedMessageKey, setSelectedMessageKey] = useState(null); // Selected message
  const [copiedMessageKey, setCopiedMessageKey] = useState(null); // Copied message key
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' | 'desc' time sorting
  const [hoveredMessageKey, setHoveredMessageKey] = useState(null); // Hovered message key
  const [groupEnabled, setGroupEnabled] = useState(false);
  const [groupField, setGroupField] = useState("requestID");
  const [groupValue, setGroupValue] = useState("");
  const [groupDisplayField, setGroupDisplayField] = useState("");
  const [groupSortMode, setGroupSortMode] = useState("firstOutgoing");
  const [collapsedGroups, setCollapsedGroups] = useState({});

  
  // Use new message highlight hook
  const { isNewMessage, clearHighlights } = useNewMessageHighlight(
    connection,
    500
  );
  
  // Reset selected message when connection switches, close detail panel, clear new message highlights
  useEffect(() => {
    setSelectedMessageKey(null);
    clearHighlights();
  }, [selectedConnectionId, clearHighlights]);

  // Keyboard navigation for message selection
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle arrow keys when we have connection and messages
      if (!connection || !connection.messages || connection.messages.length === 0) return;
      
      // Calculate filtered and sorted messages inside the effect
      const filteredMessages = filterMessages(connection.messages, {
        direction: filterDirection,
        text: filterText,
        invert: filterInvert,
      });
      
      const sortedMessages = [...filteredMessages].sort((a, b) => {
        return sortOrder === "desc"
          ? b.timestamp - a.timestamp
          : a.timestamp - b.timestamp;
      });
      
      if (sortedMessages.length === 0) return;
      
      const tableContainer = document.querySelector('.messages-table-container');
      const isTableFocused = tableContainer && document.activeElement === tableContainer;
      const hasSelectedMessage = selectedMessageKey !== null;
      
      // Handle arrow keys if table is focused OR if we have a selected message
      if ((isTableFocused || hasSelectedMessage) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        
        const currentIndex = selectedMessageKey 
          ? sortedMessages.findIndex(msg => msg.messageId === selectedMessageKey)
          : -1;
        
        let newIndex;
        if (currentIndex === -1) {
          // No message selected, select first message
          newIndex = 0;
        } else if (e.key === 'ArrowUp') {
          newIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
        } else {
          newIndex = currentIndex < sortedMessages.length - 1 ? currentIndex + 1 : currentIndex;
        }
        
        if (newIndex >= 0 && newIndex < sortedMessages.length) {
          const newMessageKey = sortedMessages[newIndex].messageId;
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
  }, [connection, filterDirection, filterText, filterInvert, sortOrder, selectedMessageKey]);

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

  // First use the original filterMessages to filter direction/text
  let filteredMessages = filterMessages(connection.messages, {
    direction: filterDirection,
    text: filterText,
    invert: filterInvert,
  });

  // Sort messages
  const sortedMessages = [...filteredMessages].sort((a, b) => {
    return sortOrder === "desc"
      ? b.timestamp - a.timestamp
      : a.timestamp - b.timestamp;
  });

  // formatMessage function has been moved to the JsonViewer component for internal handling

  const handleMessageClick = (messageKey) => {
    setSelectedMessageKey(
      selectedMessageKey === messageKey ? null : messageKey
    );
  };

  const handleSortToggle = () => {
    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
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

  const safeParseJson = (value) => {
    if (typeof value !== "string") {
      return value && typeof value === "object" ? value : null;
    }

    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  };

  const getValueByPath = (source, path) => {
    if (!source || typeof source !== "object" || !path) return undefined;

    return path.split(".").reduce((current, key) => {
      if (current === undefined || current === null) return undefined;
      return current[key];
    }, source);
  };

  const findValuesByKey = (source, targetKey) => {
    const values = [];
    const normalizedTargetKey = targetKey.toLowerCase();

    const visit = (node) => {
      if (!node || typeof node !== "object") return;

      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      Object.entries(node).forEach(([key, value]) => {
        if (key.toLowerCase() === normalizedTargetKey) {
          values.push(value);
        }
        visit(value);
      });
    };

    visit(source);
    return values;
  };

  const normalizeGroupValue = (value) => {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }
    return String(value);
  };

  const escapeRegExp = (value) => {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const extractGroupValues = (message, fieldName) => {
    if (!fieldName || !message || message.type !== "message") return [];

    const candidateData = [message.data, message.protobufDecoded].filter(
      (candidate) => candidate !== undefined && candidate !== null
    );

    for (const candidate of candidateData) {
      const parsed = safeParseJson(candidate);
      if (!parsed) continue;

      const directValue = getValueByPath(parsed, fieldName);
      if (directValue !== undefined) {
        return [normalizeGroupValue(directValue)];
      }

      if (!fieldName.includes(".")) {
        const recursiveValues = findValuesByKey(parsed, fieldName);
        if (recursiveValues.length > 0) {
          return recursiveValues.map(normalizeGroupValue);
        }
      }
    }

    const textData = candidateData
      .filter((candidate) => typeof candidate === "string")
      .join("\n");

    if (!textData) return [];

    const fieldPattern = escapeRegExp(fieldName);
    const quotedStringValuePattern = new RegExp(
      `"${fieldPattern}"\\s*:\\s*"([^"]*)"`,
      "i"
    );
    const primitiveValuePattern = new RegExp(
      `"${fieldPattern}"\\s*:\\s*([^,}\\]\\s]+)`,
      "i"
    );
    const match =
      textData.match(quotedStringValuePattern) ||
      textData.match(primitiveValuePattern);

    return match ? [match[1]] : [];
  };

  const messageMatchesGroupValue = (message, fieldName, value) => {
    const expectedValue = value.trim();
    const values = extractGroupValues(message, fieldName);

    if (!expectedValue) {
      return values.length > 0;
    }

    return values.some((currentValue) => currentValue === expectedValue);
  };

  const getGroupDisplayValue = (messages, displayField) => {
    const trimmedDisplayField = displayField.trim();
    if (!trimmedDisplayField) return "";

    const uniqueValues = [];
    const seenValues = new Set();

    messages.forEach((message) => {
      extractGroupValues(message, trimmedDisplayField).forEach((value) => {
        if (!value || seenValues.has(value)) return;
        seenValues.add(value);
        uniqueValues.push(value);
      });
    });

    if (uniqueValues.length === 0) return "";

    const visibleValues = uniqueValues.slice(0, 2).join(", ");
    return uniqueValues.length > 2
      ? `${trimmedDisplayField}: ${visibleValues} +${uniqueValues.length - 2}`
      : `${trimmedDisplayField}: ${visibleValues}`;
  };

  const getFirstOutgoingTimestamp = (messages) => {
    const outgoingTimestamps = messages
      .filter((message) => message.direction === "outgoing")
      .map((message) => message.timestamp);

    if (outgoingTimestamps.length > 0) {
      return Math.min(...outgoingTimestamps);
    }

    const messageTimestamps = messages.map((message) => message.timestamp);
    return messageTimestamps.length > 0 ? Math.min(...messageTimestamps) : Number.MAX_SAFE_INTEGER;
  };

  const getFirstMessageTimestamp = (messages) => {
    const messageTimestamps = messages.map((message) => message.timestamp);
    return messageTimestamps.length > 0 ? Math.min(...messageTimestamps) : Number.MAX_SAFE_INTEGER;
  };

  const getLatestMessageTimestamp = (messages) => {
    const messageTimestamps = messages.map((message) => message.timestamp);
    return messageTimestamps.length > 0 ? Math.max(...messageTimestamps) : Number.MIN_SAFE_INTEGER;
  };

  const sortSections = (sections) => {
    return [...sections].sort((a, b) => {
      let diff = 0;

      switch (groupSortMode) {
        case "firstMessage":
          diff = getFirstMessageTimestamp(a.messages) - getFirstMessageTimestamp(b.messages);
          break;
        case "latestMessage":
          diff = getLatestMessageTimestamp(b.messages) - getLatestMessageTimestamp(a.messages);
          break;
        case "groupValue":
          diff = a.title.localeCompare(b.title);
          break;
        case "messageCount":
          diff = b.messages.length - a.messages.length;
          break;
        case "firstOutgoing":
        default:
          diff = getFirstOutgoingTimestamp(a.messages) - getFirstOutgoingTimestamp(b.messages);
          break;
      }

      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });
  };

  const getMessageSections = () => {
    const trimmedField = groupField.trim();
    const trimmedValue = groupValue.trim();

    if (!groupEnabled || !trimmedField) {
      return [{ id: "all", title: "", messages: sortedMessages, isGrouped: false }];
    }

    if (trimmedValue) {
      const groupedMessages = [];
      const ungroupedMessages = [];

      sortedMessages.forEach((message) => {
        if (messageMatchesGroupValue(message, trimmedField, trimmedValue)) {
          groupedMessages.push(message);
        } else {
          ungroupedMessages.push(message);
        }
      });

      return sortSections([
        {
          id: `match:${trimmedField}:${trimmedValue}`,
          title: `${trimmedField} = ${trimmedValue}`,
          messages: groupedMessages,
          displayValue: getGroupDisplayValue(groupedMessages, groupDisplayField),
          isGrouped: true,
        },
        {
          id: `other:${trimmedField}:${trimmedValue}`,
          title: t("messageDetails.grouping.other"),
          messages: ungroupedMessages,
          displayValue: getGroupDisplayValue(ungroupedMessages, groupDisplayField),
          isGrouped: true,
        },
      ].filter((section) => section.messages.length > 0));
    }

    const sectionsByValue = new Map();
    const noValueMessages = [];

    sortedMessages.forEach((message) => {
      const values = extractGroupValues(message, trimmedField);
      if (values.length === 0) {
        noValueMessages.push(message);
        return;
      }

      const firstValue = values[0];
      if (!sectionsByValue.has(firstValue)) {
        sectionsByValue.set(firstValue, []);
      }
      sectionsByValue.get(firstValue).push(message);
    });

    const groupedSections = Array.from(sectionsByValue.entries()).map(
      ([value, messages]) => ({
        id: `value:${trimmedField}:${value}`,
        title: `${trimmedField} = ${value}`,
        messages,
        displayValue: getGroupDisplayValue(messages, groupDisplayField),
        isGrouped: true,
      })
    );

    if (noValueMessages.length > 0) {
      groupedSections.push({
        id: `missing:${trimmedField}`,
        title: t("messageDetails.grouping.noField", { field: trimmedField }),
        messages: noValueMessages,
        displayValue: getGroupDisplayValue(noValueMessages, groupDisplayField),
        isGrouped: true,
      });
    }

    return sortSections(groupedSections);
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
    return sortedMessages.find((msg) => {
      return msg.messageId === selectedMessageKey;
    });
  };

  const renderDataCell = (message) => {
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

  const messageSections = getMessageSections();

  const renderMessageRow = (message, index) => {
    const messageKey = message.messageId;
    const isSelected = selectedMessageKey === messageKey;
    const isNewMsg = isNewMessage(messageKey);
    const isHovered = hoveredMessageKey === messageKey;

    return (
      <tr
        key={`${messageKey}-${index}`}
        data-message-id={messageKey}
        className={`message-row ${message.direction} ${message.simulated ? "simulated" : ""} ${
          message.blocked ? "blocked" : ""
        } ${isSelected ? "selected" : ""} ${isNewMsg ? "new-message" : ""} ${
          isHovered ? "hovered" : ""
        }`}
        onClick={() => handleMessageClick(messageKey)}
        onMouseEnter={() => setHoveredMessageKey(messageKey)}
        onMouseLeave={() => setHoveredMessageKey(null)}
      >
        <td className="col-data">
          <div className="data-cell-wrapper">{renderDataCell(message)}</div>
        </td>
        <td className="col-length">{getMessageLength(message)}</td>
        <td className="col-time">{formatTimestamp(message.timestamp)}</td>
      </tr>
    );
  };

  return (
    <div className="message-details">
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
        </div>
      </div>

      <div className="messages-container">
        {sortedMessages.length === 0 ? (
          <div className="empty-state">
            <p>{t("messageDetails.emptyState.noMessages")}</p>
          </div>
        ) : (
          <PanelGroup direction="vertical">
            <Panel defaultSize={selectedMessageKey ? 70 : 100} minSize={5}>
              <div 
                className="messages-table-container" 
                tabIndex={0}
                style={{ outline: 'none' }}
              >
                <table className="ws-messages-table">
                  <thead>
                    <tr>
                      <th className="col-data">{t("messageDetails.table.data")}</th>
                      <th className="col-length">{t("messageDetails.table.length")}</th>
                      <th className="col-time" onClick={handleSortToggle} style={{ cursor: "pointer" }}>
                        {t("messageDetails.table.time")} {sortOrder === "desc" ? "▼" : "▲"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {messageSections.map((section) => (
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
                                <span className="message-group-count">{section.messages.length}</span>
                              </button>
                            </td>
                          </tr>
                        )}
                        {(!section.isGrouped || !collapsedGroups[section.id]) &&
                          section.messages.map((message, index) =>
                            renderMessageRow(message, `${section.id}-${index}`)
                          )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {selectedMessageKey && (
              <>
                <PanelResizeHandle className="panel-resize-handle horizontal message-detail-resize-handle" />
                <Panel
                  defaultSize={50}
                  minSize={10}
                  maxSize={95}
                  style={{
                    boxShadow: "rgba(21, 21, 21, 0.81) 0px -5px 20px 20px",
                    borderTopLeftRadius: "20px",
                    borderTopRightRadius: "20px",
                  }}
                >
                  <div className="message-detail-simple" key={selectedConnectionId}>
                    <div className="detail-content">
                      {(() => {
                        const selectedMessage = getSelectedMessage();
                        if (!selectedMessage) return null;

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
        )}
      </div>
    </div>
  );
};

export default MessageDetails;
