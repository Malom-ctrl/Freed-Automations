export async function activate(api) {
  function registerDefinitions(registry, api) {
    // Helper: Render Tag Input
    const renderTagInput = (container, value, onChange, options = {}) => {
      container.className = "automation-tag-input-container";
      container.style.display = "flex";
      container.style.flexWrap = "wrap";
      container.style.gap = "0.25rem";
      container.style.border = "1px solid var(--border)";
      container.style.padding = "0.25rem";
      container.style.borderRadius = "4px";
      container.style.background = "var(--bg-card)";
      container.style.alignItems = "center";
      container.style.flex = "1";

      // Parse value
      let tagsArray = [];
      try {
        tagsArray = value ? JSON.parse(value) : [];
      } catch (e) {
        tagsArray = value ? [value] : [];
      }

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Add tag...";
      input.style.border = "none";
      input.style.background = "transparent";
      input.style.outline = "none";
      input.style.flex = "1";
      input.style.minWidth = "80px";
      input.style.color = "var(--text-main)";

      const renderPills = async () => {
        Array.from(container.querySelectorAll(".tag-pill")).forEach((p) =>
          p.remove(),
        );

        for (let index = 0; index < tagsArray.length; index++) {
          const tagName = tagsArray[index];
          const tagObj = await api.data.getTag(tagName);

          const pill = document.createElement("span");
          pill.className = "tag-pill";
          pill.style.setProperty(
            "--tag-color",
            tagObj ? tagObj.color : "var(--primary)",
          );
          pill.textContent = tagName;

          const removeBtn = document.createElement("span");
          removeBtn.className = "remove-tag";
          removeBtn.textContent = "\u00D7";
          removeBtn.onclick = (e) => {
            e.stopPropagation();
            tagsArray.splice(index, 1);
            onChange(JSON.stringify(tagsArray));
            renderPills();
          };

          pill.appendChild(removeBtn);
          container.insertBefore(pill, input);
        }
      };

      container.appendChild(input);
      renderPills();

      api.ui.utils.setupGenericTagInput(input, {
        getExclusions: () => tagsArray.map((t) => t.name || t),
        onlyExisting: options.onlyExisting || false,
        onTagAdded: (newTag) => {
          if (!tagsArray.find((t) => (t.name || t) === newTag.name)) {
            tagsArray.push(newTag.name);
            onChange(JSON.stringify(tagsArray));
            renderPills();
          }
        },
      });
    };

    // --- EVENTS ---
    registry.registerEvent({
      id: "new_article",
      label: "New Article Fetched",
      targetType: "article",
    });
    registry.registerEvent({
      id: "article_favorited",
      label: "Article Favorited",
      targetType: "article",
    });
    registry.registerEvent({
      id: "article_read",
      label: "Article Read",
      targetType: "article",
    });
    registry.registerEvent({
      id: "feed_added",
      label: "Feed Added",
      targetType: "feed",
    });
    registry.registerEvent({
      id: "feed_tag_added",
      label: "Tag Added to Feed",
      targetType: "feed",
    });
    registry.registerEvent({
      id: "scheduled",
      label: "Scheduled Time (Hourly)",
      targetType: "article",
    });

    // --- CONDITIONS ---
    registry.registerCondition({
      id: "always",
      label: "Always (No Condition)",
      compatibleTargetTypes: ["article", "feed"],
      evaluate: () => ({ isMatch: true }),
    });

    registry.registerCondition({
      id: "title_contains",
      label: "Title Contains",
      compatibleTargetTypes: ["article", "feed"],
      evaluate: (target, value) => {
        const title = (target.title || "").toLowerCase();
        const val = (value || "").toLowerCase();
        const isMatch = title.includes(val);
        return { isMatch, matchContext: isMatch ? val : "" };
      },
    });

    registry.registerCondition({
      id: "content_contains",
      label: "Content Contains",
      compatibleTargetTypes: ["article"],
      evaluate: (target, value) => {
        const content = (
          (target.content || "") +
          " " +
          (target.snippet || "")
        ).toLowerCase();
        const val = (value || "").toLowerCase();
        const isMatch = content.includes(val);
        return { isMatch, matchContext: isMatch ? val : "" };
      },
    });

    registry.registerCondition({
      id: "url_contains",
      label: "URL Contains",
      compatibleTargetTypes: ["article", "feed"],
      evaluate: (target, value) => {
        const url = (target.link || target.url || "").toLowerCase();
        const val = (value || "").toLowerCase();
        const isMatch = url.includes(val);
        return { isMatch, matchContext: isMatch ? val : "" };
      },
    });

    registry.registerCondition({
      id: "feed_is",
      label: "Feed Is",
      compatibleTargetTypes: ["article"],
      evaluate: (target, value) => ({ isMatch: target.feedId === value }),
      renderInput: async (container, value, onChange) => {
        const feeds = await api.data.getAllFeeds();
        const select = document.createElement("select");
        feeds.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.title;
          select.appendChild(opt);
        });
        select.value = value || (feeds.length > 0 ? feeds[0].id : "");
        select.onchange = (e) => onChange(e.target.value);
        // Initialize value if empty
        if (!value && feeds.length > 0) onChange(feeds[0].id);
        container.appendChild(select);
      },
    });

    registry.registerCondition({
      id: "has_media",
      label: "Has Media (Audio/Video)",
      compatibleTargetTypes: ["article"],
      evaluate: (target) => ({ isMatch: !!target.mediaType }),
    });

    registry.registerCondition({
      id: "has_tag",
      label: "Has Tag",
      compatibleTargetTypes: ["article", "feed"],
      evaluate: async (target, value, extraContext) => {
        let tags = [];
        if (target.tags) {
          tags = target.tags;
        } else if (target.feedId) {
          const feed = await api.data.getFeed(target.feedId);
          if (feed) tags = feed.tags || [];
        }

        let requiredTags = [];
        try {
          requiredTags = JSON.parse(value);
        } catch (e) {
          requiredTags = value ? [value] : [];
        }

        const isMatch = requiredTags.some((rt) =>
          tags.map((t) => t.toLowerCase()).includes(rt.toLowerCase()),
        );
        return { isMatch };
      },
      renderInput: (container, value, onChange) => {
        renderTagInput(container, value, onChange, { onlyExisting: true });
      },
    });

    registry.registerCondition({
      id: "date_check",
      label: "Date Check",
      compatibleTargetTypes: ["article", "feed"],
      evaluate: (target, value, extraContext) => {
        const [operator, ...rest] = (value || "").split(":");
        const dateVal = rest.join(":");
        const targetDate = new Date(
          target.pubDate || target.addedAt || Date.now(),
        );
        const now = new Date();
        let isMatch = false;

        if (operator === "more_recent_than") {
          const days = parseInt(dateVal, 10);
          if (!isNaN(days)) {
            const diffTime = Math.abs(now - targetDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            isMatch = diffDays <= days;
          }
        } else if (operator === "older_than") {
          const days = parseInt(dateVal, 10);
          if (!isNaN(days)) {
            const diffTime = Math.abs(now - targetDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            isMatch = diffDays > days;
          }
        } else if (operator === "before") {
          const compareDate = new Date(dateVal);
          if (!isNaN(compareDate)) isMatch = targetDate < compareDate;
        } else if (operator === "after") {
          const compareDate = new Date(dateVal);
          if (!isNaN(compareDate)) isMatch = targetDate > compareDate;
        }
        return { isMatch };
      },
      renderInput: (container, value, onChange) => {
        container.className = "automation-row";
        container.style.flex = "1";

        const dateOpSelect = document.createElement("select");
        const ops = [
          { v: "more_recent_than", t: "More recent than (days)" },
          { v: "older_than", t: "Older than (days)" },
          { v: "before", t: "Before date" },
          { v: "after", t: "After date" },
        ];
        ops.forEach((o) => {
          const opt = document.createElement("option");
          opt.value = o.v;
          opt.textContent = o.t;
          dateOpSelect.appendChild(opt);
        });

        const dateValInput = document.createElement("input");

        let [dateOp, ...dateRest] = (value || "").split(":");
        if (!ops.find((o) => o.v === dateOp)) {
          dateOp = "more_recent_than";
          dateRest = [""];
        }
        dateOpSelect.value = dateOp;
        dateValInput.value = dateRest.join(":");

        const updateValue = () =>
          onChange(`${dateOpSelect.value}:${dateValInput.value}`);

        dateOpSelect.onchange = (e) => {
          if (["before", "after"].includes(e.target.value)) {
            dateValInput.type = "date";
          } else {
            dateValInput.type = "number";
          }
          updateValue();
        };

        dateValInput.oninput = updateValue;

        if (["before", "after"].includes(dateOp)) {
          dateValInput.type = "date";
        } else {
          dateValInput.type = "number";
        }

        container.appendChild(dateOpSelect);
        container.appendChild(dateValInput);
      },
    });

    // --- ACTIONS ---
    registry.registerAction({
      id: "discard",
      label: "Discard Article",
      compatibleTargetTypes: ["article"],
      execute: (target) => {
        target.discarded = true;
        return { modified: true };
      },
    });

    registry.registerAction({
      id: "mark_read",
      label: "Mark as Read",
      compatibleTargetTypes: ["article"],
      execute: (target) => {
        target.readingProgress = 1;
        target.read = true;
        return { modified: true };
      },
    });

    registry.registerAction({
      id: "favorite",
      label: "Mark as Favorite",
      compatibleTargetTypes: ["article"],
      execute: (target) => {
        target.favorite = true;
        return { modified: true };
      },
    });

    registry.registerAction({
      id: "add_tag",
      label: "Add Tag to Feed",
      compatibleTargetTypes: ["article", "feed"],
      execute: async (target, value, extraContext) => {
        let tagsToAdd = [];
        try {
          tagsToAdd = JSON.parse(value);
        } catch (e) {
          tagsToAdd = value ? [value] : [];
        }

        let feed = null;
        if (target.feedId) {
          // Article
          feed = await api.data.getFeed(target.feedId);
        } else {
          // Feed
          feed = target;
        }

        if (feed) {
          if (!feed.tags) feed.tags = [];
          let modified = false;
          tagsToAdd.forEach((t) => {
            if (!feed.tags.includes(t)) {
              feed.tags.push(t);
              modified = true;
            }
          });

          if (modified) {
            if (target.feedId) {
              await api.data.saveFeed(feed);
              api.app.refresh();
              return { modified: false }; // Target (article) not modified, but feed was
            } else {
              return { modified: true }; // Target (feed) modified
            }
          }
        }
        return { modified: false };
      },
      renderInput: (container, value, onChange) => {
        renderTagInput(container, value, onChange, { onlyExisting: false });
      },
    });

    registry.registerAction({
      id: "remove_tag",
      label: "Remove Tag from Feed",
      compatibleTargetTypes: ["article", "feed"],
      execute: async (target, value, extraContext) => {
        let tagsToRemove = [];
        try {
          tagsToRemove = JSON.parse(value);
        } catch (e) {
          tagsToRemove = value ? [value] : [];
        }

        let feed = null;
        if (target.feedId) {
          // Article
          feed = await api.data.getFeed(target.feedId);
        } else {
          // Feed
          feed = target;
        }

        if (feed && feed.tags) {
          const oldLen = feed.tags.length;
          feed.tags = feed.tags.filter((t) => !tagsToRemove.includes(t));

          if (feed.tags.length !== oldLen) {
            if (target.feedId) {
              await api.data.saveFeed(feed);
              api.app.refresh();
              return { modified: false };
            } else {
              return { modified: true };
            }
          }
        }
        return { modified: false };
      },
      renderInput: (container, value, onChange) => {
        renderTagInput(container, value, onChange, { onlyExisting: true });
      },
    });

    registry.registerAction({
      id: "notify",
      label: "Show Notification",
      compatibleTargetTypes: ["article", "feed"],
      execute: (target, value, extraContext, ruleName) => {
        api.ui.toast(value || `Automation: ${ruleName} triggered`);
        return { modified: false };
      },
      renderInput: (container, value, onChange) => {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Notification text... (use {{article.title}})";
        input.value = value || "";
        input.oninput = (e) => onChange(e.target.value);
        container.appendChild(input);
      },
    });

    registry.registerAction({
      id: "trigger_webhook",
      label: "Trigger Webhook",
      compatibleTargetTypes: ["article", "feed"],
      execute: async (target, value, extraContext, ruleName, eventType) => {
        try {
          await fetch(value, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: eventType,
              rule: ruleName,
              target,
              extraContext,
            }),
          });
        } catch (e) {
          console.error("Webhook failed", e);
        }
        return { modified: false };
      },
      renderInput: (container, value, onChange) => {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Webhook URL...";
        input.value = value || "";
        input.oninput = (e) => onChange(e.target.value);
        container.appendChild(input);
      },
    });
  }

  api.namespace.register("registerDefinitions", registerDefinitions);
}
