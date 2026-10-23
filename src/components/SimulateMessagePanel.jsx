import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useMemo,
} from "react";
import { Rnd } from "react-rnd";
import { Tabs } from "@mantine/core";
import { 
  FileText, 
  Star, 
  Settings, 
  MessageSquare,
  Wifi,
  Pin,
  Minus,
  Download,
  Upload,
  Clock,
  PinOff,
  CircleArrowDown,
  CircleArrowUp,
  Send,
  Move,
  Plus,
  Activity,
  Wrench
} from "lucide-react";
import JsonViewer from "./JsonViewer";
import useWindowConstraints from "../hooks/useWindowConstraints";
import useAutoResize from "../hooks/useAutoResize";
import useWindowAnimation from "../hooks/useWindowAnimation";
import usePanelManager from "../hooks/usePanelManager";
import FavoritesTab from "./FavoritesTab";
import SystemEventsTab from "./SystemEventsTab";
import ManualConnectModal from "./ManualConnectModal";
import globalFavorites, { addFromEditor } from "../utils/globalFavorites";
import { t } from "../utils/i18n";
import SimulateEditorTab from "./SimulateEditorTab";

const SimulateMessagePanel = forwardRef(
  ({ connection, onSimulateMessage, onManualConnect }, ref) => {
    const [simulateMessage, setSimulateMessage] = useState(
      t("simulate.content.jsonPlaceholder")
    );
    const [isSending, setIsSending] = useState(false);
    const [isWindowOpen, setIsWindowOpen] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [windowPosition, setWindowPosition] = useState({ x: 20, y: 20 });
    const [windowSize, setWindowSize] = useState({ width: 400, height: 500 });
    const [activeTab, setActiveTab] = useState("editor");
    const [addFavoriteCallback, setAddFavoriteCallback] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const windowRef = useRef(null);
    const saveTimeoutRef = useRef(null);
    const listenersRef = useRef(null);
    
    // Manual connection state
    const [isManualConnectOpen, setIsManualConnectOpen] = useState(false);

    // Use window constraints hook
    const { maxSize, validateAndFixPositionAndSize } = useWindowConstraints();

    // Use window animation hook
    const { isAnimating, animateWindowOpen } =
      useWindowAnimation(setWindowPosition);

    // Use panel management hook
    const { openPanel, toggleWindow, minimizeWindow } = usePanelManager({
      isWindowOpen,
      isAnimating,
      windowSize,
      setIsWindowOpen,
      setWindowSize,
      validateAndFixPositionAndSize,
      animateWindowOpen,
    });

    // Use auto-resize hook
    useAutoResize({
      isWindowOpen,
      isAnimating,
      windowPosition,
      windowSize,
      validateAndFixPositionAndSize,
      setWindowPosition,
      setWindowSize,
    });

    // Debounced save to localStorage
    const debouncedSave = useCallback((stateToSave) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        try {
          localStorage.setItem(
            "simulateMessagePanel",
            JSON.stringify(stateToSave)
          );
        } catch (error) {
          // console.error("Failed to save state:", error); Removed for clean up.
        }
      }, 300); // 300ms debounce
    }, []);

    // Optimization: only set listeners on component mount to avoid recreating
    useEffect(() => {
      // Listen for favorites service events and tab switch
      const unsubscribeFavorites = globalFavorites.addListener(
        (favorites, eventData) => {
          // Ignore favorites changes during drag to avoid interference
          if (isDragging) return;

          if (eventData?.type === "add" && eventData?.switchToFavoritesTab) {
            setActiveTab("favorites");
          }
          
          // Handle navigation to favorites tab
          if (eventData?.type === "navigate_to_favorites" && eventData?.switchToFavoritesTab) {
            setActiveTab("favorites");
          }
        }
      );

      const unsubscribeTabSwitch = globalFavorites.addTabSwitchCallback(() => {
        // Ignore tab switch requests during drag
        if (isDragging) return;
        setActiveTab("favorites");
      });

      // Cache listener unsubscribe functions
      listenersRef.current = () => {
        unsubscribeFavorites();
        unsubscribeTabSwitch();
      };

      return () => {
        if (listenersRef.current) {
          listenersRef.current();
        }
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }, []); // Removed isDragging dependency to avoid recreating listeners

    // Load saved state from localStorage (only executed once on component mount)
    useEffect(() => {
      const savedState = localStorage.getItem("simulateMessagePanel");
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          setSimulateMessage(
            parsed.message ||
              t("simulate.content.jsonPlaceholder")
          );
          setIsPinned(parsed.isPinned || false);
          setWindowPosition(
            parsed.position || { 
              x: window.innerWidth - 400 - 30, 
              y: window.innerHeight - 500 - 30 
            }
          );
          setWindowSize(parsed.size || { width: 400, height: 500 });
        } catch (error) {
          // console.error("Failed to load saved state:", error); Removed for clean up.
        }
      } else {
        setWindowPosition({ 
          x: window.innerWidth - 490 - 15, 
          y: window.innerHeight - 490 - 15 
        });
      }
    }, []); // Empty dependency array, only runs once on mount

    // Optimization: pause localStorage saving during drag
    useEffect(() => {
      // Ignore position changes during animation or drag to avoid saving temporary positions
      if (isAnimating || isDragging) return;

      const stateToSave = {
        message: simulateMessage,
        isPinned,
        position: windowPosition,
        size: windowSize,
      };
      debouncedSave(stateToSave);
    }, [
      simulateMessage,
      isPinned,
      windowPosition,
      windowSize,
      isAnimating,
      isDragging, // Added isDragging dependency
      debouncedSave,
    ]);

    // Handle click outside to close (only add listener when window is open)
    useEffect(() => {
      if (!isWindowOpen || isPinned) return;

      const handleClickOutside = (event) => {
        if (
          windowRef.current &&
          !windowRef.current.contains(event.target) &&
          !event.target.closest(".floating-simulate-button")
        ) {
          setIsWindowOpen(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [isWindowOpen, isPinned]);

    // Use useCallback to optimize function references
    const handleSimulateMessage = useCallback(
      async (direction, data = null) => {
        const messageData = data || simulateMessage;

        if (!connection || !messageData.trim() || isSending) {
          return;
        }

        setIsSending(true);

        try {
          await onSimulateMessage({
            connectionId: connection.id,
            message: messageData,
            direction: direction,
          });
        } catch (error) {
          // console.error("Failed to simulate message:", error); Removed for clean up.
        } finally {
          setTimeout(() => setIsSending(false), 200);
        }
      },
      [connection, simulateMessage, isSending, onSimulateMessage]
    );

    const handleMessageChange = useCallback(
      (value) => {

        setSimulateMessage(value);
      },
      [simulateMessage]
    );

    const handleKeyPress = useCallback(
      (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleSimulateMessage("incoming");
        }
      },
      [handleSimulateMessage]
    );

    const handleAddToFavorites = useCallback(
      (data = null) => {
        const messageData = data || simulateMessage;
        if (!messageData.trim()) return;

        addFromEditor(messageData, {
          switchToFavoritesTab: true,
          generateName: true,
          autoEdit: true,
          showNotification: true,
        });
      },
      [simulateMessage]
    );

    const handleSimulateSystemEvent = useCallback(
      async (eventData) => {
        if (!connection || !eventData) {
          return;
        }

        setIsSending(true);

        try {
          // Send system event simulation request to background script
          await chrome.runtime.sendMessage({
            type: "simulate-system-event",
            data: {
              ...eventData,
              connectionId: connection.id,
            },
          });

        } catch (error) {
        } finally {
          setTimeout(() => setIsSending(false), 500);
        }
      },
      [connection]
    );



    const clearMessage = () => {
      setSimulateMessage("");
    };

    // Expose openPanel function to external use
    useImperativeHandle(ref, () => ({
      openPanel: (options = {}) => {
        // ); Removed for clean up.
        openPanel();

        // If tab is specified, switch to the corresponding tab
        if (options.tab) {
          setActiveTab(options.tab);

          // New: fill content when switching to editor
          if (options.tab === "editor" && options.data) {
            setSimulateMessage(options.data);
          }

          // If data is specified and switching to favorites tab, add to favorites with a delay
          if (options.tab === "favorites" && options.data) {
            setTimeout(() => {
              const newFavorite = addFromEditor(options.data, {
                switchToFavoritesTab: false, // Do not switch tab again, as we have already switched
                generateName: false, // Generate an empty name for user editing
                autoEdit: true, // Automatically enter edit mode
                showNotification: false, // Do not show notification
              });
            }, 100);
          }
        }
      },
    }));

    const togglePin = () => {
      setIsPinned(!isPinned);
    };

    // Optimization: add drag start and end handlers
    const handleDragStart = useCallback(() => {
      setIsDragging(true);
    }, []);

    const handleDragStop = useCallback((e, data) => {
      setWindowPosition({ x: data.x, y: data.y });
      // Delay reset drag state to ensure state update is complete
      setTimeout(() => setIsDragging(false), 50);
    }, []);

    const handleResizeStop = useCallback(
      (e, direction, ref, delta, position) => {
        setWindowSize({
          width: ref.style.width,
          height: ref.style.height,
        });
        setWindowPosition(position);
      },
      []
    );

    // Optimize button state calculation
    const isSimulateDisabled = useMemo(
      () => !simulateMessage.trim() || isSending,
      [simulateMessage, isSending]
    );

    // Reusable simulate button component
    const SimulateButton = ({ direction, icon: Icon, label, className }) => (
      <button
        className={`simulate-btn ${className}`}
        onClick={() => handleSimulateMessage(direction)}
        disabled={isSimulateDisabled}
      >
        <Icon size={16} />
        {label}
      </button>
    );

    // Optimization: use useMemo to cache FavoritesTab props to avoid unnecessary re-renders
    const favoritesTabProps = useMemo(
      () => ({
        onSendMessage: (data) => handleSimulateMessage("outgoing", data),
        onReceiveMessage: (data) => handleSimulateMessage("incoming", data),
        onAddFavorite: (callback) => setAddFavoriteCallback(() => callback),
      }),
      [handleSimulateMessage]
    );

    // Implement handleSimulateNestedParse within the component
    const handleSimulateNestedParse = useCallback((nestedContent) => {
      handleMessageChange(nestedContent);
    }, [handleMessageChange]);

    return (
      <>
        {/* Floating toggle button - only show when panel is closed */}
        {!isWindowOpen && (
          <div
            className={`floating-simulate-button ${isWindowOpen ? "open" : ""}`}
            onClick={toggleWindow}
          >
            <div className="simulate-icon">
              <Send size={30} />
            </div>
            <div className="simulate-tooltip">
              {t("simulate.tooltips.open")}
            </div>
          </div>
        )}

        {/* Draggable and resizable window */}
        {isWindowOpen && (
          <Rnd
            size={windowSize}
            position={windowPosition}
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
            onResizeStop={handleResizeStop}
            minWidth={500}
            minHeight={450}
            maxWidth={maxSize.width}
            maxHeight={maxSize.height}
            bounds="parent"
            dragHandleClassName="simulate-window-header"
            className={`simulate-floating-window ${isPinned ? "pinned" : ""}`}
            style={{
              zIndex: 1000,
            }}
          >
            <div className="simulate-window-container" ref={windowRef}>
              {/* Window header - draggable area */}
              <div
                className={`simulate-window-header ${isPinned ? "pinned" : ""}`}
              >
                <div className="simulate-window-title">
                  <Move size={16} className="simulate-icon-small" />
                  <span>{t("simulate.title")}</span>
                  {connection && (
                    <span className="connection-indicator">
                      - {connection.url}
                    </span>
                  )}
                </div>
                <div className="simulate-window-controls">
                  <button
                    className={`window-control-btn pin ${
                      isPinned ? "active" : ""
                    }`}
                    onClick={togglePin}
                    title={
                      isPinned
                        ? t("simulate.tooltips.unpin")
                        : t("simulate.tooltips.pin")
                    }
                  >
                    {isPinned ? <Pin size={12} /> : <Pin size={12} />}
                  </button>
                  <button
                    className="window-control-btn minimize"
                    onClick={minimizeWindow}
                    title={t("simulate.tooltips.minimize")}
                  >
                    <Minus size={12} />
                  </button>
                </div>
              </div>

              {/* Window content */}
              <div className="simulate-window-content">
                {!connection ? (
                  <div className="simulate-panel-empty floating">
                    <div className="simulate-empty-state">
                      <div className="simulate-empty-icon">
                        <Activity size={48} color="white" />
                      </div>
                      <h3 className="simulate-empty-title">
                        {t("simulate.status.noConnection")}
                      </h3>
                      <p className="simulate-empty-description">
                        {t("simulate.status.noConnectionDescription")}
                      </p>
                      <button
                        className="simulate-add-connection-btn"
                        onClick={() => setIsManualConnectOpen(true)}
                      >
                        <Plus size={16} />
                        {t("panel.connectionList.addConnection")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <Tabs
                    defaultValue="editor"
                    variant="outline"
                    value={activeTab}
                    onChange={setActiveTab}
                    orientation="vertical"
                    placement="left"
                  >
                    <Tabs.List>
                      <Tabs.Tab
                        value="editor"
                        leftSection={
                          <Send
                            size={20}
                            color={activeTab === "editor" ? "var(--simulate-editor-icon, #2196f3)" : "var(--simulate-inactive-icon, #b6b6b6)"}
                            // color={"#2196f3"}
                            className="tab-icon"
                          />
                        }
                      ></Tabs.Tab>
                      <Tabs.Tab
                        value="favorites"
                        leftSection={
                          <Star
                            size={20}
                            color={activeTab === "favorites" ? "var(--simulate-favorite-icon, #FFD600)" : "var(--simulate-inactive-icon, #b6b6b6)"}
                            // color={"#FFD600"}
                            className="tab-icon"
                          />
                        }
                      ></Tabs.Tab>
                      <Tabs.Tab
                        value="system"
                        leftSection={
                          <Wrench
                            size={20}
                            color={activeTab === "system" ? "var(--simulate-system-icon, #cd7726)" : "var(--simulate-inactive-icon, #b6b6b6)"}
                            // color={"#e01210"}
                            className="tab-icon"
                          />
                        }
                      ></Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="editor">
                      <SimulateEditorTab
                        message={simulateMessage}
                        isSending={isSending}
                        onChange={handleMessageChange}
                        onSimulate={handleSimulateMessage}
                        onAddToFavorites={handleAddToFavorites}
                        onKeyPress={handleKeyPress}
                        onSimulateNestedParse={handleSimulateNestedParse}
                      />
                    </Tabs.Panel>

                    <Tabs.Panel value="favorites">
                      <FavoritesTab {...favoritesTabProps} />
                    </Tabs.Panel>

                    <Tabs.Panel value="system">
                      <SystemEventsTab 
                        connection={connection}
                        onSimulateSystemEvent={handleSimulateSystemEvent}
                      />
                    </Tabs.Panel>
                  </Tabs>
                )}
              </div>
            </div>
          </Rnd>
        )}

        {/* Manual Connection Modal */}
        <ManualConnectModal
          opened={isManualConnectOpen}
          onClose={() => setIsManualConnectOpen(false)}
          onConnect={onManualConnect}
          iconComponent={Activity}
        />
      </>
    );
  }
);

export default SimulateMessagePanel;
