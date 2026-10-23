import React, { memo, useState } from "react";
import { t } from "../utils/i18n.js";

const STATUS_KEYS = {
  missing: "messageDetails.projection.status.missing",
  "invalid-json": "messageDetails.projection.status.invalidJson",
  unsupported: "messageDetails.projection.status.unsupported",
  "not-applicable": "messageDetails.projection.status.notApplicable",
};

// Stop once a seventh line is proven instead of allocating an array for every newline.
const hasMoreThanSixLines = (text) => {
  let newlineIndex = -1;
  for (let count = 0; count < 6; count += 1) {
    newlineIndex = text.indexOf("\n", newlineIndex + 1);
    if (newlineIndex === -1) return false;
  }
  return true;
};

const MessageProjectionValue = memo(({ result, locale }) => {
  const [expanded, setExpanded] = useState(false);

  if (result.status !== "matched") {
    return <span className="message-projection-state">{t(STATUS_KEYS[result.status])}</span>;
  }

  const { formatted } = result;
  if (formatted.isEmptyString) {
    return <span className="message-projection-state">{t("messageDetails.projection.status.empty")}</span>;
  }
  if (formatted.isWhitespaceOnly) {
    return (
      <span className="message-projection-whitespace" aria-label={JSON.stringify(formatted.text)}>
        {t("messageDetails.projection.status.whitespace")}
      </span>
    );
  }

  const needsExpand = formatted.text.length > 480 || hasMoreThanSixLines(formatted.text);
  return (
    <span className="message-projection-value-wrapper">
      <span className={`message-projection-value ${needsExpand && !expanded ? "clamped" : ""}`}>{formatted.text}</span>
      {needsExpand && (
        <button type="button" className="message-projection-expand" onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}>
          {expanded ? t("messageDetails.projection.collapse") : t("messageDetails.projection.expand")}
        </button>
      )}
    </span>
  );
});

export default MessageProjectionValue;
