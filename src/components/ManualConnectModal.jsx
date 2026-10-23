import React, { useState, useCallback, useRef, useEffect } from "react";
import { Modal, TextInput, Tooltip } from "@mantine/core";
import { ArrowRightLeft, Globe, Zap, Activity, History, Clock, Hash, Trash2 } from "lucide-react";
import { t } from "../utils/i18n";
import wsHistoryService from "../utils/wsHistoryService";

const ManualConnectModal = ({ 
  opened, 
  onClose, 
  onConnect, 
  iconComponent = ArrowRightLeft,
  title 
}) => {
  const [wsUrl, setWsUrl] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);

  // Load history when modal opens and set up listener
  useEffect(() => {
    if (opened) {
      // Load initial history
      setHistory(wsHistoryService.getHistory());
      
      // Listen for history changes
      const unsubscribe = wsHistoryService.addListener((newHistory) => {
        setHistory(newHistory);
      });
      
      // Auto-focus input when modal opens
      const timer = setTimeout(() => {
        // Try various ways to focus the input
        if (inputRef.current) {
          // If it's a Mantine TextInput, it might need to focus the internal input element
          const inputElement = inputRef.current.querySelector('input') || inputRef.current;
          if (inputElement && inputElement.focus) {
            inputElement.focus();
          }
        } else {
          // Fallback: find input by selector
          const modalInput = document.querySelector('.ws-modal input[type="text"]');
          if (modalInput) {
            modalInput.focus();
          }
        }
      }, 200); // Increase delay to ensure Modal animation completes
      
      return () => {
        clearTimeout(timer);
        unsubscribe();
      };
    }
  }, [opened]);

  // Validate WebSocket URL
  const isValidWsUrl = useCallback((url) => {
    try {
      const wsUrl = new URL(url);
      return wsUrl.protocol === "ws:" || wsUrl.protocol === "wss:";
    } catch {
      return false;
    }
  }, []);

  // Handle manual connection
  const handleManualConnect = async () => {
    if (!wsUrl.trim() || !onConnect) return;
    
    setIsConnecting(true);
    try {
      const result = await onConnect(wsUrl.trim());
      
      // Add to history on successful connection
      wsHistoryService.addConnection(wsUrl.trim());
      
      setWsUrl("");
      onClose();
      return result;
    } catch (error) {
      // console.error("Failed to create manual WebSocket connection:", error); Removed for clean up.
      onClose();
      setWsUrl("");
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle close
  const handleClose = () => {
    setWsUrl("");
    onClose();
  };

  // Handle history item click
  const handleHistoryItemClick = (historyItem) => {
    setWsUrl(historyItem.url);
    // Auto-focus input after setting URL
    setTimeout(() => {
      if (inputRef.current) {
        const inputElement = inputRef.current.querySelector('input') || inputRef.current;
        if (inputElement && inputElement.focus) {
          inputElement.focus();
          inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
        }
      }
    }, 50);
  };

  // Handle history item delete
  const handleHistoryItemDelete = (e, historyItem) => {
    e.stopPropagation(); // Prevent triggering the item click
    wsHistoryService.deleteConnection(historyItem.id);
  };

  const IconComponent = iconComponent;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={title || t("panel.connectionList.modal.title")}
      size="md"
      centered
      zIndex={1500}
      classNames={{
        modal: 'ws-modal',
        header: 'ws-modal-header',
        title: 'ws-modal-title',
        close: 'ws-modal-close',
        content: 'ws-modal-content',
        body: 'ws-modal-body',
        overlay: 'ws-modal-overlay',
      }}
    >
      <div className="ws-modal-content-wrapper">
        {/* Modal header with icon and description */}
        <div className="ws-modal-header-section">
          <div className="ws-modal-icon-container">
            <IconComponent size={24} className="ws-modal-icon" />
          </div>
          <div className="ws-modal-description">
            <p className="ws-modal-description-text">
              {t("panel.connectionList.modal.description")}
            </p>
            <div className="ws-modal-features">
              <div className="ws-modal-feature">
                <Globe size={14} />
                <span>{t("panel.connectionList.modal.feature1")}</span>
              </div>
              <div className="ws-modal-feature">
                <Zap size={14} />
                <span>{t("panel.connectionList.modal.feature2")}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* WebSocket History Section */}
        <div className="ws-history-section">
          <div className="ws-history-header">
            <div className="ws-history-title">
              <History size={16} />
{t("panel.connectionList.modal.history.title")}
              <span className="ws-history-count">{history.length}/3</span>
            </div>
          </div>
          {history.length > 0 ? (
            <div className="ws-history-list">
              {history.map((item) => (
                <Tooltip
                  key={item.id}
                  label={item.url}
                  arrowSize={6}
                  arrowOffset={12}
                  zIndex={1600}
                  withinPortal={true}
                  openDelay={100}
                  styles={{
                    tooltip: {
                      background: "var(--tooltip-background, rgba(30, 30, 30, 0.95))",
                      color: "var(--tooltip-text, #f3f4f6)",
                      border: "1px solid var(--tooltip-border, rgba(255, 255, 255, 0.2))",
                      borderRadius: "6px",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: "400",
                      backdropFilter: "blur(8px)",
                      boxShadow: "var(--tooltip-shadow, 0 10px 40px rgba(0, 0, 0, 0.6), 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.3))",
                    },
                    arrow: {
                      borderColor: "var(--tooltip-background, rgba(30, 30, 30, 0.95))",
                    },
                  }}
                >
                  <div
                    className="ws-history-item"
                    onClick={() => handleHistoryItemClick(item)}
                  >
                    <div className="ws-history-item-icon">
                      <Activity size={12} />
                    </div>
                    <div className="ws-history-item-content">
                      <div className="ws-history-item-url">
                        {item.url}
                      </div>
                      <div className="ws-history-item-meta">
                        <Clock size={10} />
                        {wsHistoryService.formatLastUsed(item.lastUsed)}
                        <Hash size={10} />
                        {item.usageCount}
                      </div>
                    </div>
                    <button
                      className="ws-history-item-delete"
                      onClick={(e) => handleHistoryItemDelete(e, item)}
                      title="Delete from history"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </Tooltip>
              ))}
            </div>
          ) : (
            <div className="ws-history-empty">
              <div className="ws-history-empty-icon">
                <History size={16} />
              </div>
              <span>{t("panel.connectionList.modal.history.empty")}</span>
            </div>
          )}
        </div>
        
        {/* Divider before TextInput */}
        <div className="ws-modal-divider" style={{ margin: "0" }}></div>
        
        <TextInput
           ref={inputRef}
           label={t("panel.connectionList.modal.urlLabel")}
           placeholder={t("panel.connectionList.modal.urlPlaceholder")}
           value={wsUrl}
           onChange={(e) => setWsUrl(e.currentTarget.value)}
           onKeyDown={(e) => {
             if (e.key === 'Enter' && !isConnecting && isValidWsUrl(wsUrl)) {
               e.preventDefault();
               handleManualConnect();
             }
           }}
           disabled={isConnecting}
           error={wsUrl.length > 0 && !isValidWsUrl(wsUrl) ? t("panel.connectionList.modal.urlError") : null}
           size="sm"
           classNames={{
             label: 'ws-text-input-label',
             input: `ws-text-input-field ${wsUrl.length > 0 && !isValidWsUrl(wsUrl) ? 'ws-text-input-error' : ''}`,
             error: 'ws-text-input-error-text',
           }}
        />
        
        <div className="modal-button-group">
          <button
            className="modal-button modal-button-cancel"
            onClick={handleClose}
            disabled={isConnecting}
          >
            {t("common.cancel")}
          </button>
          
          <button
            className="modal-button modal-button-connect"
            onClick={handleManualConnect}
            disabled={isConnecting || !isValidWsUrl(wsUrl)}
          >
            <ArrowRightLeft size={16} />
            {t("panel.connectionList.modal.connect")}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ManualConnectModal; 