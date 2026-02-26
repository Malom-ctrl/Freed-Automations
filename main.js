class AutomationsPlugin {
  constructor(api) {
    this.api = api;
    this.rules = [];
    this.intervalId = null;
  }

  async activate() {
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

    const result = await this.applyRulesToArticle(article, eventType);
    if (result.modified) {
      await this.api.data.saveArticle(result.article);
      this.api.app.refresh();
    }
  }

  async processArticlesForEvent(articles, eventType) {
    if (!this.rules || this.rules.length === 0) return articles;

    const modifiedArticles = [];
    for (const article of articles) {
      const result = await this.applyRulesToArticle(article, eventType);
      modifiedArticles.push(result.article);
    }
    return modifiedArticles;
  }

  async processScheduledRules() {
    const scheduledRules = this.rules.filter((r) => r.event === "scheduled");
    if (scheduledRules.length === 0) return;

    const articles = await this.api.data.getArticlesByFeed("all");
    let modifiedCount = 0;

    for (const article of articles) {
      const result = await this.applyRulesToArticle(article, "scheduled");
      if (result.modified) {
        await this.api.data.saveArticle(result.article);
        modifiedCount++;
      }
    }

    if (modifiedCount > 0) {
      this.api.app.refresh();
    }
  }

  evaluateCondition(condition, article) {
    const value = condition.value ? condition.value.toLowerCase() : "";
    const title = (article.title || "").toLowerCase();
    const content = (
      (article.content || "") +
      " " +
      (article.snippet || "")
    ).toLowerCase();
    const url = (article.link || "").toLowerCase();

    let isMatch = false;
    let matchContext = "";

    switch (condition.field) {
      case "title_contains":
        isMatch = title.includes(value);
        if (isMatch) matchContext = value;
        break;
      case "content_contains":
        isMatch = content.includes(value);
        if (isMatch) matchContext = value;
        break;
      case "url_contains":
        isMatch = url.includes(value);
        if (isMatch) matchContext = value;
        break;
      case "feed_is":
        isMatch = article.feedId === condition.value;
        break;
      case "has_media":
        isMatch = !!article.mediaType;
        break;
      case "always":
        isMatch = true;
        break;
    }

    if (condition.invert) {
      isMatch = !isMatch;
      matchContext = ""; // Inverted matches don't provide context
    }

    return { isMatch, matchContext };
  }

  replaceVariables(text, article, matchContext) {
    if (!text) return "";
    return text
      .replace(/\{\{article\.title\}\}/g, article.title || "")
      .replace(/\{\{article\.url\}\}/g, article.link || "")
      .replace(/\{\{condition\.match\}\}/g, matchContext || "");
  }

  async applyRulesToArticle(article, eventType) {
    let modifiedArticle = { ...article };
    let modified = false;

    for (const rule of this.rules) {
      if (rule.event !== eventType) continue;

      let ruleMatched = false;
      let ruleMatchContext = "";

      if (!rule.conditions || rule.conditions.length === 0) {
        ruleMatched = true;
      } else {
        let matches = [];
        for (const cond of rule.conditions) {
          matches.push(this.evaluateCondition(cond, modifiedArticle));
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
            // Combine contexts or just take the first non-empty one
            const firstContext = matches.find((m) => m.matchContext);
            if (firstContext) ruleMatchContext = firstContext.matchContext;
          }
        }
      }

      if (ruleMatched) {
        for (const action of rule.actions) {
          const actionValue = this.replaceVariables(
            action.value,
            modifiedArticle,
            ruleMatchContext,
          );

          switch (action.type) {
            case "discard":
              modifiedArticle.discarded = true;
              modified = true;
              break;
            case "mark_read":
              modifiedArticle.readingProgress = 1;
              modifiedArticle.read = true;
              modified = true;
              break;
            case "favorite":
              modifiedArticle.favorite = true;
              modified = true;
              break;
            case "notify":
              this.api.ui.toast(
                actionValue || `Automation: ${rule.name} triggered`,
              );
              break;
          }
        }
      }
    }

    return { article: modifiedArticle, modified };
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

      const eventNames = {
        new_article: "New Article Fetched",
        article_favorited: "Article Favorited",
        article_read: "Article Read",
        scheduled: "Scheduled Time",
      };

      let condText =
        rule.conditions.length +
        " condition" +
        (rule.conditions.length !== 1 ? "s" : "");
      let actText =
        rule.actions.length +
        " action" +
        (rule.actions.length !== 1 ? "s" : "");

      details.textContent = `When ${eventNames[rule.event] || rule.event} • ${condText} • ${actText}`;

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
    eventSelect.appendChild(
      this.createOption("new_article", "New Article Fetched"),
    );
    eventSelect.appendChild(
      this.createOption("article_favorited", "Article Favorited"),
    );
    eventSelect.appendChild(this.createOption("article_read", "Article Read"));
    eventSelect.appendChild(
      this.createOption("scheduled", "Scheduled Time (Hourly)"),
    );
    eventSelect.value = currentRule.event;
    eventSelect.onchange = (e) => (currentRule.event = e.target.value);
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

    const feeds = await this.api.data.getAllFeeds();

    const renderConditions = () => {
      this.emptyContainer(conditionsList);
      currentRule.conditions.forEach((cond, index) => {
        const row = document.createElement("div");
        row.className = "automation-row";

        const select = document.createElement("select");
        select.appendChild(
          this.createOption("always", "Always (No Condition)"),
        );
        select.appendChild(
          this.createOption("title_contains", "Title Contains"),
        );
        select.appendChild(
          this.createOption("content_contains", "Content Contains"),
        );
        select.appendChild(this.createOption("url_contains", "URL Contains"));
        select.appendChild(this.createOption("feed_is", "Feed Is"));
        select.appendChild(
          this.createOption("has_media", "Has Media (Audio/Video)"),
        );
        select.value = cond.field;

        const notBtn = document.createElement("button");
        notBtn.type = "button";
        notBtn.className = "btn-not" + (cond.invert ? " active" : "");
        notBtn.textContent = "NOT";
        notBtn.onclick = () => {
          cond.invert = !cond.invert;
          notBtn.className = "btn-not" + (cond.invert ? " active" : "");
        };

        const valInput = document.createElement("input");
        valInput.type = "text";
        valInput.placeholder = "Value...";
        valInput.value = cond.value;
        valInput.oninput = (e) => (cond.value = e.target.value);

        const feedSelect = document.createElement("select");
        feeds.forEach((f) =>
          feedSelect.appendChild(this.createOption(f.id, f.title)),
        );
        feedSelect.value = cond.value;
        feedSelect.onchange = (e) => (cond.value = e.target.value);

        const updateInputs = () => {
          valInput.classList.add("automation-hidden");
          feedSelect.classList.add("automation-hidden");

          if (
            ["title_contains", "content_contains", "url_contains"].includes(
              select.value,
            )
          ) {
            valInput.classList.remove("automation-hidden");
          } else if (select.value === "feed_is") {
            feedSelect.classList.remove("automation-hidden");
            if (!cond.value && feeds.length > 0) {
              cond.value = feeds[0].id;
              feedSelect.value = feeds[0].id;
            } else {
              feedSelect.value = cond.value;
            }
          } else {
            cond.value = "";
          }
        };

        select.onchange = (e) => {
          cond.field = e.target.value;
          updateInputs();
        };

        const delBtn = document.createElement("button");
        delBtn.className = "automation-row-delete";
        delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`;
        delBtn.onclick = () => {
          currentRule.conditions.splice(index, 1);
          renderConditions();
        };

        row.appendChild(select);
        row.appendChild(notBtn);
        row.appendChild(valInput);
        row.appendChild(feedSelect);
        row.appendChild(delBtn);

        updateInputs();
        conditionsList.appendChild(row);
      });
    };

    renderConditions();

    const addCondBtn = document.createElement("button");
    addCondBtn.className = "btn btn-outline automation-btn-add";
    addCondBtn.textContent = "+ Add Condition";
    addCondBtn.onclick = () => {
      currentRule.conditions.push({
        id: this.api.ui.utils.generateId(),
        field: "title_contains",
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
      currentRule.actions.forEach((act, index) => {
        const row = document.createElement("div");
        row.className = "automation-row";

        const select = document.createElement("select");
        select.appendChild(this.createOption("discard", "Discard Article"));
        select.appendChild(this.createOption("mark_read", "Mark as Read"));
        select.appendChild(this.createOption("favorite", "Mark as Favorite"));
        select.appendChild(this.createOption("notify", "Show Notification"));
        select.value = act.type;

        const valInput = document.createElement("input");
        valInput.type = "text";
        valInput.placeholder = "Notification text... (use {{article.title}})";
        valInput.value = act.value;
        valInput.oninput = (e) => (act.value = e.target.value);

        const updateInputs = () => {
          valInput.classList.add("automation-hidden");
          if (select.value === "notify") {
            valInput.classList.remove("automation-hidden");
          } else {
            act.value = "";
          }
        };

        select.onchange = (e) => {
          act.type = e.target.value;
          updateInputs();
        };

        const delBtn = document.createElement("button");
        delBtn.className = "automation-row-delete";
        delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`;
        delBtn.onclick = () => {
          currentRule.actions.splice(index, 1);
          renderActions();
        };

        row.appendChild(select);
        row.appendChild(valInput);
        row.appendChild(delBtn);

        updateInputs();
        actionsList.appendChild(row);
      });
    };

    renderActions();

    const addActBtn = document.createElement("button");
    addActBtn.className = "btn btn-outline automation-btn-add";
    addActBtn.textContent = "+ Add Action";
    addActBtn.onclick = () => {
      currentRule.actions.push({
        id: this.api.ui.utils.generateId(),
        type: "discard",
        value: "",
      });
      renderActions();
    };
    actionsBlock.appendChild(addActBtn);
    form.appendChild(actionsBlock);

    // Save/Cancel Buttons
    const actions = document.createElement("div");
    actions.className = "automation-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save Rule";
    saveBtn.onclick = async () => {
      if (!currentRule.name.trim()) {
        this.api.ui.toast("Please enter a rule name.");
        return;
      }
      if (currentRule.conditions.length === 0) {
        this.api.ui.toast("Please add at least one condition.");
        return;
      }
      if (currentRule.actions.length === 0) {
        this.api.ui.toast("Please add at least one action.");
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
      this.api.ui.toast("Rule saved.");
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-outline";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => this.renderSettings(container);

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    container.appendChild(form);
  }

  createFormGroup(labelText) {
    const group = document.createElement("div");
    group.className = "automation-form-group";
    const label = document.createElement("label");
    label.textContent = labelText;
    group.appendChild(label);
    return group;
  }
}

export async function activate(api) {
  const plugin = new AutomationsPlugin(api);
  await plugin.activate();
}
