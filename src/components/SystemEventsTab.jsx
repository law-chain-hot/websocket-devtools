"use client"

import React, { useState, useCallback } from "react";
import { 
  Wrench, 
  Monitor, 
  Server, 
  Play, 
  AlertTriangle, 
  X, 
  Clock, 
  Wifi, 
  WifiOff, 
  CircleAlert 
} from "lucide-react";
import "../styles/SystemEventsTab.css";
import { t } from "../utils/i18n";
import { Tooltip } from "@mantine/core";

const SystemEventsTab = ({ connection, onSimulateSystemEvent }) => {
  const [activeTab, setActiveTab] = useState("client");
  const [closeCode, setCloseCode] = useState("1000");
  const [closeReason, setCloseReason] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [customCodeMode, setCustomCodeMode] = useState(false);
  const [serverCloseCode, setServerCloseCode] = useState("1000");
  const [serverCloseReason, setServerCloseReason] = useState("");
  const [serverCustomCodeMode, setServerCustomCodeMode] = useState(false);

  // Close code options
  const closeCodeOptions = [
    { value: "1000", label: t("system.closeCode.1000") },
    { value: "1001", label: t("system.closeCode.1001") },
    { value: "1002", label: t("system.closeCode.1002") },
    { value: "1008", label: t("system.closeCode.1008") },
    { value: "1009", label: t("system.closeCode.1009") },
    { value: "1011", label: t("system.closeCode.1011") },
    { value: "custom", label: t("system.closeCode.custom") },
  ];

  // Get close code explanation info
  const getCloseCodeInfo = (code) => {
    const numCode = parseInt(code);
    if (numCode === 1000) {
      return { type: "success", message: t("system.closeCodeInfo.normal") };
    } else if (numCode >= 1001 && numCode <= 2999) {
      return { type: "warning", message: t("system.closeCodeInfo.protocol") };
    } else if (numCode >= 3000 && numCode <= 4999) {
      return { type: "success", message: t("system.closeCodeInfo.application") };
    } else {
      return { type: "error", message: t("system.closeCodeInfo.invalid") };
    }
  };

  // Handle system event simulation
  const handleSimulateEvent = useCallback(async (eventType, options = {}) => {
    if (!connection || isExecuting) return;

    setIsExecuting(true);
    
    try {
      await onSimulateSystemEvent({
        connectionId: connection.id,
        eventType,
        ...options
      });
    } catch (error) {
      // console.error("Failed to simulate system event:", error); Removed for clean up.
    } finally {
      setTimeout(() => setIsExecuting(false), 500);
    }
  }, [connection, isExecuting, onSimulateSystemEvent]);

  // Client event handlers
  const handleClientClose = () => {
    handleSimulateEvent("client-close", {
      code: parseInt(closeCode),
      reason: closeReason || t("system.events.close.clientInitiated")
    });
  };

  const handleClientError = (errorType) => {
    const errorDetails = {
      "connection-failed": { code: "ECONNREFUSED", message: t("system.events.error.connectionFailed") },
      "network-disconnect": { code: "ENETUNREACH", message: t("system.events.error.networkDisconnect") },
      "protocol-error": { code: "EPROTO", message: t("system.events.error.protocolError") },
      "timeout-error": { code: "ETIMEDOUT", message: t("system.events.error.timeoutError") },
      "unexpected-condition": { code: "EUNEXPECTED", message: t("system.events.error.unexpectedCondition") }
    };

    handleSimulateEvent("client-error", {
      errorType,
      ...errorDetails[errorType]
    });
  };

  // Server event handlers
  const handleServerClose = (closeType) => {
    if (closeType === "custom") {
      handleSimulateEvent("server-close", {
        code: parseInt(serverCloseCode),
        reason: serverCloseReason || t("system.events.close.serverInitiated")
      });
    } else {
      const closeDetails = {
        "normal-server-close": { code: 1000, reason: t("system.events.close.serverNormal") },
        "policy-violation": { code: 1008, reason: t("system.events.close.policyViolation") },
        "heartbeat-timeout": { code: 1011, reason: t("system.events.close.heartbeatTimeout") },
        "auth-failure": { code: 4001, reason: t("system.events.close.authFailure") }
      };

      handleSimulateEvent("server-close", closeDetails[closeType]);
    }
  };

  const handleServerError = (errorType) => {
    const errorDetails = {
      "message-format-error": { code: 1003, message: t("system.events.error.messageFormatError") },
      "client-disconnect": { code: 1006, message: t("system.events.error.clientDisconnect") },
      "internal-server-error": { code: 1011, message: t("system.events.error.internalServerError") },
      "resource-exhausted": { code: 1013, message: t("system.events.error.resourceExhausted") },
      "service-restart": { code: 1012, message: t("system.events.error.serviceRestart") }
    };

    handleSimulateEvent("server-error", {
      errorType,
      ...errorDetails[errorType]
    });
  };

  if (!connection) {
    return (
      <div className="sys-evt-empty">
        <div className="sys-evt-empty-state">
          <Wifi size={48} className="sys-evt-empty-icon" />
          <h4>{t("system.noConnectionTitle")}</h4>
          <p>{t("system.noConnection")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="system-events-tab">
      <div className="sys-evt-header">
        <div className="sys-evt-header-content">
          <Wrench className="sys-evt-header-icon" />
          <div className="sys-evt-header-text">
            <h2 style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
              {t("system.title")}
              <Tooltip
                label={<span style={{whiteSpace: 'pre-line'}}>{t("system.closeEvent.notice")}</span>}
                color="var(--system-tooltip-background, rgb(65, 43, 6))"
                position="right"
                withArrow
                arrowSize={6}
                arrowOffset={12}
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  background: "var(--system-tooltip-background, rgb(65, 43, 6))",
                  color: "var(--system-warning-text, #f59e0b)",
                  borderLeft: "3px solid var(--system-warning-text, #f59e0b)",
                  borderRadius: 4,
                  padding: "10px 14px",
                  maxWidth: 340,
                  lineHeight: 1.7,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-line',
                }}
                zIndex={1600}
                hoverable
                openDelay={100}
                closeDelay={200}
                withinPortal={false}
              >
                <CircleAlert size={12} style={{ color: "var(--system-warning-text, #f59e0b)", cursor: "pointer", verticalAlign: 'middle' }} />
              </Tooltip>
            </h2>
            <p>{t("system.description")}</p>
          </div>
        </div>
      </div>

      <div className="sys-evt-content">
        <div className="sys-evt-tabs-container">
          <div className="sys-evt-tabs-list">
            <button
              className={`sys-evt-tab-trigger ${activeTab === "client" ? "active" : ""}`}
              onClick={() => setActiveTab("client")}
            >
              <Monitor size={16} />
              {t("system.tabs.client")}
            </button>
            <button
              className={`sys-evt-tab-trigger ${activeTab === "server" ? "active" : ""}`}
              onClick={() => setActiveTab("server")}
            >
              <Server size={16} />
              {t("system.tabs.server")}
            </button>
          </div>

          <div className="sys-evt-tab-content">
            {activeTab === "client" && (
              <div className="sys-evt-client-events">
                <div className="sys-evt-events-grid">
                  {/* Close Events Card */}
                  <div className="sys-evt-event-card sys-evt-close-events">
                    <div className="sys-evt-card-header">
                      <div className="sys-evt-card-title">
                        <X className="sys-evt-card-icon sys-evt-close-icon" />
                        {t("system.events.close.title")}
                      </div>
                      <div className="sys-evt-card-description">{t("system.events.close.description")}</div>
                    </div>
                    <div className="sys-evt-card-content">
                      <div className="sys-evt-form-group">
                        <label className="sys-evt-form-label">{t("system.events.close.code")}</label>
                        {!customCodeMode ? (
                          <select
                            className="sys-evt-form-select"
                            value={closeCode}
                            onChange={(e) => {
                              if (e.target.value === "custom") {
                                setCustomCodeMode(true);
                                setCloseCode("3000");
                              } else {
                                setCloseCode(e.target.value);
                              }
                            }}
                          >
                            {closeCodeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="sys-evt-custom-code-container">
                            <input
                              type="number"
                              className="sys-evt-form-input"
                              placeholder={t("system.events.close.codePlaceholder")}
                              value={closeCode}
                              onChange={(e) => setCloseCode(e.target.value)}
                              min="1000"
                              max="4999"
                            />
                            <button
                              className="sys-evt-reset-button"
                              onClick={() => {
                                setCustomCodeMode(false);
                                setCloseCode("1000");
                              }}
                              title={t("system.tooltips.resetToPreset")}
                            >
                              ↺
                            </button>
                          </div>
                        )}
                        {closeCode && (
                          <div className={`sys-evt-code-info sys-evt-code-info-${getCloseCodeInfo(closeCode).type}`}>
                            {getCloseCodeInfo(closeCode).message}
                          </div>
                        )}
                      </div>
                      <div className="sys-evt-form-group">
                        <label className="sys-evt-form-label">{t("system.events.close.reason")}</label>
                        <input
                          type="text"
                          className="sys-evt-form-input"
                          placeholder={t("system.events.close.reasonPlaceholder")}
                          value={closeReason}
                          onChange={(e) => setCloseReason(e.target.value)}
                        />
                      </div>
                      <button
                        className="sys-evt-event-button sys-evt-close-button"
                        onClick={handleClientClose}
                        disabled={isExecuting}
                      >
                        <Play size={16} />
                        {t("system.events.close.simulate")}
                      </button>
                    </div>
                  </div>

                  {/* Error Events Card */}
                  <div className="sys-evt-event-card sys-evt-error-events">
                    <div className="sys-evt-card-header">
                      <div className="sys-evt-card-title">
                        <AlertTriangle className="sys-evt-card-icon sys-evt-error-icon" />
                        {t("system.events.error.title")}
                      </div>
                      <div className="sys-evt-card-description">{t("system.events.error.description")}</div>
                    </div>
                    <div className="sys-evt-card-content">
                      <div className="sys-evt-error-buttons">
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleClientError("connection-failed")}
                          disabled={isExecuting}
                        >
                          <Wifi size={16} />
                          {t("system.events.error.connectionFailed")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleClientError("network-disconnect")}
                          disabled={isExecuting}
                        >
                          <WifiOff size={16} />
                          {t("system.events.error.networkDisconnect")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleClientError("protocol-error")}
                          disabled={isExecuting}
                        >
                          <AlertTriangle size={16} />
                          {t("system.events.error.protocolError")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleClientError("timeout-error")}
                          disabled={isExecuting}
                        >
                          <Clock size={16} />
                          {t("system.events.error.timeoutError")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleClientError("unexpected-condition")}
                          disabled={isExecuting}
                        >
                          <X size={16} />
                          {t("system.events.error.unexpectedCondition", "Unexpected condition")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "server" && (
              <div className="sys-evt-server-events">
                <div className="sys-evt-events-grid">
                  {/* Server Close Card */}
                  <div className="sys-evt-event-card sys-evt-close-events">
                    <div className="sys-evt-card-header">
                      <div className="sys-evt-card-title">
                        <X className="sys-evt-card-icon sys-evt-close-icon" />
                        {t("system.events.close.serverTitle")}
                      </div>
                      <div className="sys-evt-card-description">{t("system.events.close.serverDescription")}</div>
                    </div>
                    <div className="sys-evt-card-content">
                      <div className="sys-evt-form-group">
                        <label className="sys-evt-form-label">{t("system.events.close.serverCode")}</label>
                        {!serverCustomCodeMode ? (
                          <select
                            className="sys-evt-form-select"
                            value={serverCloseCode}
                            onChange={(e) => {
                              if (e.target.value === "custom") {
                                setServerCustomCodeMode(true);
                                setServerCloseCode("1001");
                              } else {
                                setServerCloseCode(e.target.value);
                              }
                            }}
                          >
                            {closeCodeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                            <option value="4001">{t("system.closeCode.4001")}</option>
                          </select>
                        ) : (
                          <div className="sys-evt-custom-code-container">
                            <input
                              type="number"
                              className="sys-evt-form-input"
                              placeholder={t("system.events.close.serverCodePlaceholder")}
                              value={serverCloseCode}
                              onChange={(e) => setServerCloseCode(e.target.value)}
                              min="1000"
                              max="4999"
                            />
                            <button
                              className="sys-evt-reset-button"
                              onClick={() => {
                                setServerCustomCodeMode(false);
                                setServerCloseCode("1000");
                              }}
                              title={t("system.tooltips.resetToPreset")}
                            >
                              ↺
                            </button>
                          </div>
                        )}
                        <div className="sys-evt-code-info sys-evt-code-info-success">
                          {t("system.closeCodeInfo.serverSupport")}
                        </div>
                      </div>
                      <div className="sys-evt-form-group">
                        <label className="sys-evt-form-label">{t("system.events.close.serverReason")}</label>
                        <input
                          type="text"
                          className="sys-evt-form-input"
                          placeholder={t("system.events.close.serverReasonPlaceholder")}
                          value={serverCloseReason}
                          onChange={(e) => setServerCloseReason(e.target.value)}
                        />
                      </div>
                      <button
                        className="sys-evt-event-button sys-evt-close-button"
                        onClick={() => handleServerClose("custom")}
                        disabled={isExecuting}
                      >
                        <Play size={16} />
                        {t("system.events.close.serverSimulate")}
                      </button>
                    </div>
                  </div>

                  {/* Server Errors Card */}
                  <div className="sys-evt-event-card sys-evt-error-events">
                    <div className="sys-evt-card-header">
                      <div className="sys-evt-card-title">
                        <AlertTriangle className="sys-evt-card-icon sys-evt-error-icon" />
                        {t("system.events.error.serverTitle")}
                      </div>
                      <div className="sys-evt-card-description">{t("system.events.error.serverDescription")}</div>
                    </div>
                    <div className="sys-evt-card-content">
                      <div className="sys-evt-error-buttons">
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleServerError("message-format-error")}
                          disabled={isExecuting}
                        >
                          <AlertTriangle size={16} />
                          {t("system.events.error.messageFormatError")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleServerError("client-disconnect")}
                          disabled={isExecuting}
                        >
                          <WifiOff size={16} />
                          {t("system.events.error.clientDisconnect")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleServerError("internal-server-error")}
                          disabled={isExecuting}
                        >
                          <Wrench size={16} />
                          {t("system.events.error.internalServerError")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleServerError("resource-exhausted")}
                          disabled={isExecuting}
                        >
                          <Server size={16} />
                          {t("system.events.error.resourceExhausted")}
                        </button>
                        <button
                          className="sys-evt-event-button sys-evt-error-button"
                          onClick={() => handleServerError("service-restart")}
                          disabled={isExecuting}
                        >
                          <X size={16} />
                          {t("system.events.error.serviceRestart", "Service restart")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemEventsTab; 