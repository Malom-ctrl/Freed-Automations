class AutomationsPlugin {
  constructor(api) {
    this.api = api;
    this.rules = [];
    this.intervalId = null;
    this.registry = null;
  }

  async activate() {
    const AutomationRegistry = this.api.namespace.get("AutomationRegistry");
    const registerDefinitions = this.api.namespace.get("registerDefinitions");

    this.registry = new AutomationRegistry();
    registerDefinitions(this.registry, this.api);

    this.rules = (await this.api.storage.get("rules")) || [];

    this.api.ui.settings.addTab("automations", "Automations", (container) => {
      this.renderSettings(container);
    });

    // Event Hooks
    this.api.hooks.processArticles(async (articles) => {
      return this.processArticlesForEvent(articles, "new_article");
    });

    this.api.events.on(
      "freed:article-favorited",
      async ({ guid, favorite }) => {
        if (favorite)
          await this.processSingleArticleEvent(guid, "article_favorited");
      },
    );

    this.api.events.on("freed:article-read", async ({ guid }) => {
      await this.processSingleArticleEvent(guid, "article_read");
    });

    this.api.events.on("freed:feed-added", async ({ feed }) => {
      await this.processSingleFeedEvent(feed, "feed_added");
    });

    this.api.events.on("freed:feed-tag-added", async ({ feedId, tag }) => {
      const feed = await this.api.data.getFeed(feedId);
      if (feed)
        await this.processSingleFeedEvent(feed, "feed_tag_added", { tag });
    });

    // Scheduled Time (Every hour check)
    this.intervalId = setInterval(
      () => this.processScheduledRules(),
      60 * 60 * 1000,
    );
    // Initial check after a short delay
    setTimeout(() => this.processScheduledRules(), 5000);
  }

  async deactivate() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async saveRules() {
    await this.api.storage.set("rules", this.rules);
  }

  async processSingleArticleEvent(guid, eventType) {
    const article = await this.api.data.getArticle(guid);
    if (!article) return;

    const result = await this.applyRules(article, "article", eventType);
    if (result.modified) {
      await this.api.data.saveArticle(result.target);
      this.api.app.refresh();
    }
  }

  async processArticlesForEvent(articles, eventType) {
    if (!this.rules || this.rules.length === 0) return articles;

    const modifiedArticles = [];
    for (const article of articles) {
      const result = await this.applyRules(article, "article", eventType);
      modifiedArticles.push(result.target);
    }
    return modifiedArticles;
  }

  async processScheduledRules() {
    const scheduledRules = this.rules.filter((r) => r.event === "scheduled");
    if (scheduledRules.length === 0) return;

    const articles = await this.api.data.getArticlesByFeed("all");
    let modifiedCount = 0;

    for (const article of articles) {
      const result = await this.applyRules(article, "article", "scheduled");
      if (result.modified) {
        await this.api.data.saveArticle(result.target);
        modifiedCount++;
      }
    }

    if (modifiedCount > 0) {
      this.api.app.refresh();
    }
  }

  async processSingleFeedEvent(feed, eventType, extraContext) {
    const result = await this.applyRules(feed, "feed", eventType, extraContext);
    if (result.modified) {
      await this.api.data.saveFeed(result.target);
      this.api.app.refresh();
    }
  }

  replaceVariables(text, target, targetType, matchContext, extraContext) {
    if (!text) return "";
    let res = text.replace(/\{\{condition\.match\}\}/g, matchContext || "");
    if (targetType === "article") {
      res = res
        .replace(/\{\{article\.title\}\}/g, target.title || "")
        .replace(/\{\{article\.url\}\}/g, target.link || "");
    } else if (targetType === "feed") {
      res = res
        .replace(/\{\{feed\.title\}\}/g, target.title || "")
        .replace(/\{\{feed\.url\}\}/g, target.url || "");
    }
    if (extraContext && extraContext.tag) {
      res = res.replace(/\{\{tag\}\}/g, extraContext.tag || "");
    }
    return res;
  }

  async applyRules(target, targetType, eventType, extraContext) {
    let modifiedTarget = { ...target };
    let modified = false;

    for (const rule of this.rules) {
      if (rule.event !== eventType) continue;

      const eventDef = this.registry.getEvent(rule.event);
      if (!eventDef) continue;

      let ruleMatched = false;
      let ruleMatchContext = "";

      if (!rule.conditions || rule.conditions.length === 0) {
        ruleMatched = true;
      } else {
        let matches = [];
        for (const cond of rule.conditions) {
          const condDef = this.registry.getCondition(cond.field);
          if (!condDef) continue;

          const res = await condDef.evaluate(
            modifiedTarget,
            cond.value,
            extraContext,
          );
          if (cond.invert) {
            res.isMatch = !res.isMatch;
            res.matchContext = "";
          }
          matches.push(res);
        }

        if (rule.matchType === "any") {
          const firstMatch = matches.find((m) => m.isMatch);
          if (firstMatch) {
            ruleMatched = true;
            ruleMatchContext = firstMatch.matchContext;
          }
        } else {
          // "all"
          ruleMatched = matches.every((m) => m.isMatch);
          if (ruleMatched) {
            const firstContext = matches.find((m) => m.matchContext);
            if (firstContext) ruleMatchContext = firstContext.matchContext;
          }
        }
      }

      if (ruleMatched) {
        for (const action of rule.actions) {
          const actionDef = this.registry.getAction(action.type);
          if (!actionDef) continue;

          const actionValue = this.replaceVariables(
            action.value,
            modifiedTarget,
            targetType,
            ruleMatchContext,
            extraContext,
          );

          const res = await actionDef.execute(
            modifiedTarget,
            actionValue,
            extraContext,
            rule.name,
            eventType,
          );
          if (res && res.modified) modified = true;
        }
      }
    }

    return { target: modifiedTarget, modified };
  }

  emptyContainer(container) {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  createOption(value, text) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    return opt;
  }

  createFormGroup(label) {
    const group = document.createElement("div");
    group.className = "automation-form-group";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    group.appendChild(lbl);
    return group;
  }

  async renderSettings(container) {
    this.emptyContainer(container);

    const header = document.createElement("div");
    header.className = "automation-header";

    const title = document.createElement("h2");
    title.textContent = "Automations";
    title.className = "automation-header-title";

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary";
    addBtn.textContent = "Create Rule";
    addBtn.onclick = () => this.renderEditor(container);

    header.appendChild(title);
    header.appendChild(addBtn);
    container.appendChild(header);

    if (this.rules.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No automation rules created yet.";
      empty.className = "automation-empty";
      container.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "automations-container";

    for (const rule of this.rules) {
      const card = document.createElement("div");
      card.className = "automation-rule-card";

      const cardHeader = document.createElement("div");
      cardHeader.className = "automation-rule-header";

      const name = document.createElement("span");
      name.textContent = rule.name;

      const actions = document.createElement("div");
      actions.className = "automation-rule-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-outline";
      editBtn.textContent = "Edit";
      editBtn.onclick = () => this.renderEditor(container, rule);

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-outline";
      delBtn.textContent = "Delete";
      delBtn.onclick = async () => {
        if (this.api.ui.dialog.confirm("Delete this rule?")) {
          this.rules = this.rules.filter((r) => r.id !== rule.id);
          await this.saveRules();
          this.renderSettings(container);
        }
      };

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      cardHeader.appendChild(name);
      cardHeader.appendChild(actions);

      const details = document.createElement("div");
      details.className = "automation-rule-details";

      const eventDef = this.registry.getEvent(rule.event);
      const eventName = eventDef ? eventDef.label : rule.event;

      let condText =
        rule.conditions.length +
        " condition" +
        (rule.conditions.length !== 1 ? "s" : "");
      let actText =
        rule.actions.length +
        " action" +
        (rule.actions.length !== 1 ? "s" : "");

      details.textContent = `When ${eventName} • ${condText} • ${actText}`;

      card.appendChild(cardHeader);
      card.appendChild(details);
      list.appendChild(card);
    }

    container.appendChild(list);
  }

  async renderEditor(container, rule = null) {
    this.emptyContainer(container);
    const isNew = !rule;
    const currentRule = rule
      ? JSON.parse(JSON.stringify(rule))
      : {
          id: this.api.ui.utils.generateId(),
          name: "New Rule",
          event: "new_article",
          matchType: "all",
          conditions: [
            {
              id: this.api.ui.utils.generateId(),
              field: "title_contains",
              invert: false,
              value: "",
            },
          ],
          actions: [
            { id: this.api.ui.utils.generateId(), type: "discard", value: "" },
          ],
        };

    const form = document.createElement("div");
    form.className = "automation-form";

    const title = document.createElement("h3");
    title.textContent = isNew
      ? "Create Automation Rule"
      : "Edit Automation Rule";
    title.className = "automation-form-title";
    form.appendChild(title);

    // Name
    const nameGroup = this.createFormGroup("Rule Name");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = currentRule.name;
    nameInput.oninput = (e) => (currentRule.name = e.target.value);
    nameGroup.appendChild(nameInput);
    form.appendChild(nameGroup);

    // Event Block
    const eventBlock = document.createElement("div");
    eventBlock.className = "automation-block";
    const eventTitle = document.createElement("h4");
    eventTitle.className = "automation-block-title";
    eventTitle.textContent = "1. When this happens...";
    eventBlock.appendChild(eventTitle);

    const eventSelect = document.createElement("select");
    const events = this.registry.getEvents();
    events.forEach((ev) => {
      eventSelect.appendChild(this.createOption(ev.id, ev.label));
    });
    eventSelect.value = currentRule.event;
    eventBlock.appendChild(eventSelect);
    form.appendChild(eventBlock);

    // Conditions Block
    const conditionsBlock = document.createElement("div");
    conditionsBlock.className = "automation-block";

    const condHeader = document.createElement("div");
    condHeader.style.display = "flex";
    condHeader.style.justifyContent = "space-between";
    condHeader.style.alignItems = "center";

    const condTitle = document.createElement("h4");
    condTitle.className = "automation-block-title";
    condTitle.textContent = "2. If...";

    const matchTypeDiv = document.createElement("div");
    matchTypeDiv.className = "automation-match-type";
    matchTypeDiv.textContent = "Match ";
    const matchSelect = document.createElement("select");
    matchSelect.appendChild(this.createOption("all", "ALL"));
    matchSelect.appendChild(this.createOption("any", "ANY"));
    matchSelect.value = currentRule.matchType;
    matchSelect.onchange = (e) => (currentRule.matchType = e.target.value);
    matchTypeDiv.appendChild(matchSelect);
    matchTypeDiv.appendChild(document.createTextNode(" of the following:"));

    condHeader.appendChild(condTitle);
    condHeader.appendChild(matchTypeDiv);
    conditionsBlock.appendChild(condHeader);

    const conditionsList = document.createElement("div");
    conditionsList.style.display = "flex";
    conditionsList.style.flexDirection = "column";
    conditionsList.style.gap = "0.5rem";
    conditionsBlock.appendChild(conditionsList);

    const renderConditions = () => {
      this.emptyContainer(conditionsList);

      const eventDef = this.registry.getEvent(currentRule.event);
      const targetType = eventDef ? eventDef.targetType : "article";
      const availableConditions = this.registry.getConditions(targetType);

      currentRule.conditions.forEach((cond, index) => {
        const row = document.createElement("div");
        row.className = "automation-row";

        const select = document.createElement("select");
        availableConditions.forEach((c) => {
          select.appendChild(this.createOption(c.id, c.label));
        });

        // Ensure valid field
        if (!availableConditions.find((c) => c.id === cond.field)) {
          cond.field = availableConditions[0].id;
        }
        select.value = cond.field;

        const notBtn = document.createElement("button");
        notBtn.type = "button";
        notBtn.className = "btn-not" + (cond.invert ? " active" : "");
        notBtn.textContent = "NOT";
        notBtn.onclick = () => {
          cond.invert = !cond.invert;
          notBtn.className = "btn-not" + (cond.invert ? " active" : "");
        };

        const inputContainer = document.createElement("div");
        inputContainer.style.flex = "1";
        inputContainer.style.display = "flex";

        const renderInput = () => {
          this.emptyContainer(inputContainer);
          const condDef = this.registry.getCondition(cond.field);
          if (condDef && condDef.renderInput) {
            condDef.renderInput(inputContainer, cond.value, (newVal) => {
              cond.value = newVal;
            });
          } else {
            const valInput = document.createElement("input");
            valInput.type = "text";
            valInput.placeholder = "Value...";
            valInput.value = cond.value || "";
            valInput.style.width = "100%";
            valInput.oninput = (e) => (cond.value = e.target.value);
            inputContainer.appendChild(valInput);
          }
        };

        select.onchange = (e) => {
          cond.field = e.target.value;
          cond.value = ""; // Reset value on type change
          renderInput();
        };

        const delBtn = document.createElement("button");
        delBtn.className = "automation-row-delete";
        delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`;
        delBtn.onclick = () => {
          currentRule.conditions.splice(index, 1);
          renderConditions();
        };

        row.appendChild(notBtn);
        row.appendChild(select);
        row.appendChild(inputContainer);
        row.appendChild(delBtn);

        renderInput();
        conditionsList.appendChild(row);
      });
    };

    const addCondBtn = document.createElement("button");
    addCondBtn.className = "btn btn-outline automation-btn-add";
    addCondBtn.textContent = "+ Add Condition";
    addCondBtn.onclick = () => {
      const eventDef = this.registry.getEvent(currentRule.event);
      const targetType = eventDef ? eventDef.targetType : "article";
      const availableConditions = this.registry.getConditions(targetType);

      currentRule.conditions.push({
        id: this.api.ui.utils.generateId(),
        field: availableConditions[0].id,
        invert: false,
        value: "",
      });
      renderConditions();
    };
    conditionsBlock.appendChild(addCondBtn);
    form.appendChild(conditionsBlock);

    // Actions Block
    const actionsBlock = document.createElement("div");
    actionsBlock.className = "automation-block";
    const actTitle = document.createElement("h4");
    actTitle.className = "automation-block-title";
    actTitle.textContent = "3. Then do this...";
    actionsBlock.appendChild(actTitle);

    const actionsList = document.createElement("div");
    actionsList.style.display = "flex";
    actionsList.style.flexDirection = "column";
    actionsList.style.gap = "0.5rem";
    actionsBlock.appendChild(actionsList);

    const renderActions = () => {
      this.emptyContainer(actionsList);

      const eventDef = this.registry.getEvent(currentRule.event);
      const targetType = eventDef ? eventDef.targetType : "article";
      const availableActions = this.registry.getActions(targetType);

      currentRule.actions.forEach((act, index) => {
        const row = document.createElement("div");
        row.className = "automation-row";

        const select = document.createElement("select");
        availableActions.forEach((a) => {
          select.appendChild(this.createOption(a.id, a.label));
        });

        if (!availableActions.find((a) => a.id === act.type)) {
          act.type = availableActions[0].id;
        }
        select.value = act.type;

        const inputContainer = document.createElement("div");
        inputContainer.style.flex = "1";
        inputContainer.style.display = "flex";

        const renderInput = () => {
          this.emptyContainer(inputContainer);
          const actDef = this.registry.getAction(act.type);
          if (actDef && actDef.renderInput) {
            actDef.renderInput(inputContainer, act.value, (newVal) => {
              act.value = newVal;
            });
          } else {
            const valInput = document.createElement("input");
            valInput.type = "text";
            valInput.placeholder = "Value...";
            valInput.value = act.value || "";
            valInput.style.width = "100%";
            valInput.oninput = (e) => (act.value = e.target.value);
            inputContainer.appendChild(valInput);
          }
        };

        select.onchange = (e) => {
          act.type = e.target.value;
          act.value = "";
          renderInput();
        };

        const delBtn = document.createElement("button");
        delBtn.className = "automation-row-delete";
        delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`;
        delBtn.onclick = () => {
          currentRule.actions.splice(index, 1);
          renderActions();
        };

        row.appendChild(select);
        row.appendChild(inputContainer);
        row.appendChild(delBtn);

        renderInput();
        actionsList.appendChild(row);
      });
    };

    const addActBtn = document.createElement("button");
    addActBtn.className = "btn btn-outline automation-btn-add";
    addActBtn.textContent = "+ Add Action";
    addActBtn.onclick = () => {
      const eventDef = this.registry.getEvent(currentRule.event);
      const targetType = eventDef ? eventDef.targetType : "article";
      const availableActions = this.registry.getActions(targetType);

      currentRule.actions.push({
        id: this.api.ui.utils.generateId(),
        type: availableActions[0].id,
        value: "",
      });
      renderActions();
    };
    actionsBlock.appendChild(addActBtn);
    form.appendChild(actionsBlock);

    // Initial Render
    renderConditions();
    renderActions();

    // Event Change Handler
    eventSelect.onchange = (e) => {
      currentRule.event = e.target.value;

      // Filter incompatible conditions/actions
      const eventDef = this.registry.getEvent(currentRule.event);
      if (eventDef) {
        const targetType = eventDef.targetType;

        currentRule.conditions = currentRule.conditions.filter((c) => {
          const cDef = this.registry.getCondition(c.field);
          return (
            cDef &&
            (!cDef.compatibleTargetTypes ||
              cDef.compatibleTargetTypes.includes(targetType))
          );
        });

        currentRule.actions = currentRule.actions.filter((a) => {
          const aDef = this.registry.getAction(a.type);
          return (
            aDef &&
            (!aDef.compatibleTargetTypes ||
              aDef.compatibleTargetTypes.includes(targetType))
          );
        });
      }

      renderConditions();
      renderActions();
    };

    // Save/Cancel
    const footer = document.createElement("div");
    footer.className = "automation-footer";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save Rule";
    saveBtn.onclick = async () => {
      if (!currentRule.name) {
        this.api.ui.toast("Rule name is required");
        return;
      }
      if (isNew) {
        this.rules.push(currentRule);
      } else {
        const idx = this.rules.findIndex((r) => r.id === currentRule.id);
        if (idx !== -1) this.rules[idx] = currentRule;
      }
      await this.saveRules();
      this.renderSettings(container);
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-outline";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => this.renderSettings(container);

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    form.appendChild(footer);

    container.appendChild(form);
  }
}

export async function activate(api) {
  const plugin = new AutomationsPlugin(api);
  await plugin.activate();
}
