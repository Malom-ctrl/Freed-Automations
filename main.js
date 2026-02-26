class AutomationsPlugin {
  constructor(api) {
    this.api = api;
    this.rules = [];
  }

  async activate() {
    this.rules = (await this.api.storage.get("rules")) || [];

    this.api.ui.settings.addTab("automations", "Automations", (container) => {
      this.renderSettings(container);
    });

    this.api.hooks.processArticles(async (articles) => {
      return this.processArticles(articles);
    });
  }

  async saveRules() {
    await this.api.storage.set("rules", this.rules);
  }

  processArticles(articles) {
    if (!this.rules || this.rules.length === 0) return articles;

    return articles.map((article) => {
      let modifiedArticle = { ...article };

      for (const rule of this.rules) {
        if (rule.event !== "new_article") continue;

        let conditionMet = false;
        const value = rule.conditionValue
          ? rule.conditionValue.toLowerCase()
          : "";
        const title = (modifiedArticle.title || "").toLowerCase();
        const content = (
          (modifiedArticle.content || "") +
          " " +
          (modifiedArticle.snippet || "")
        ).toLowerCase();
        const url = (modifiedArticle.link || "").toLowerCase();

        switch (rule.condition) {
          case "title_contains":
            conditionMet = title.includes(value);
            break;
          case "content_contains":
            conditionMet = content.includes(value);
            break;
          case "url_contains":
            conditionMet = url.includes(value);
            break;
          case "feed_is":
            conditionMet = modifiedArticle.feedId === rule.conditionValue;
            break;
          case "has_media":
            conditionMet = !!modifiedArticle.mediaType;
            break;
          case "always":
            conditionMet = true;
            break;
        }

        if (rule.conditionInvert) {
          conditionMet = !conditionMet;
        }

        if (conditionMet) {
          switch (rule.action) {
            case "discard":
              modifiedArticle.discarded = true;
              break;
            case "mark_read":
              modifiedArticle.readingProgress = 1;
              modifiedArticle.read = true;
              break;
            case "favorite":
              modifiedArticle.favorite = true;
              break;
            case "notify":
              this.api.ui.toast(
                `Automation: ${rule.name} event occurred for "${modifiedArticle.title}"`,
              );
              break;
          }
        }
      }

      return modifiedArticle;
    });
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
      let conditionText = rule.condition.replace(/_/g, " ");
      if (rule.conditionInvert) conditionText = "NOT " + conditionText;
      if (rule.conditionValue) conditionText += `: "${rule.conditionValue}"`;
      details.textContent = `When ${rule.event.replace(/_/g, " ")} AND ${conditionText} THEN ${rule.action.replace(/_/g, " ")}`;

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
          condition: "title_contains",
          conditionInvert: false,
          conditionValue: "",
          action: "discard",
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

    // Event
    const eventGroup = this.createFormGroup("Event");
    const eventSelect = document.createElement("select");
    eventSelect.appendChild(
      this.createOption("new_article", "New Article Fetched"),
    );
    eventSelect.value = currentRule.event;
    eventSelect.onchange = (e) => (currentRule.event = e.target.value);
    eventGroup.appendChild(eventSelect);
    form.appendChild(eventGroup);

    // Condition
    const conditionGroup = this.createFormGroup("Condition");

    const conditionRow = document.createElement("div");
    conditionRow.className = "automation-condition-row";

    const conditionSelect = document.createElement("select");
    conditionSelect.appendChild(
      this.createOption("always", "Always (No Condition)"),
    );
    conditionSelect.appendChild(
      this.createOption("title_contains", "Title Contains"),
    );
    conditionSelect.appendChild(
      this.createOption("content_contains", "Content Contains"),
    );
    conditionSelect.appendChild(
      this.createOption("url_contains", "URL Contains"),
    );
    conditionSelect.appendChild(this.createOption("feed_is", "Feed Is"));
    conditionSelect.appendChild(
      this.createOption("has_media", "Has Media (Audio/Video)"),
    );

    conditionSelect.value = currentRule.condition;

    const notBtn = document.createElement("button");
    notBtn.type = "button";
    notBtn.className =
      "btn-not" + (currentRule.conditionInvert ? " active" : "");
    notBtn.textContent = "NOT";
    notBtn.onclick = () => {
      currentRule.conditionInvert = !currentRule.conditionInvert;
      if (currentRule.conditionInvert) {
        notBtn.classList.add("active");
      } else {
        notBtn.classList.remove("active");
      }
    };

    conditionRow.appendChild(conditionSelect);
    conditionRow.appendChild(notBtn);

    const conditionValueInput = document.createElement("input");
    conditionValueInput.type = "text";
    conditionValueInput.placeholder = "Value...";
    conditionValueInput.value = currentRule.conditionValue;
    conditionValueInput.className = "automation-mt-half";
    conditionValueInput.oninput = (e) =>
      (currentRule.conditionValue = e.target.value);

    const feeds = await this.api.data.getAllFeeds();
    const feedSelect = document.createElement("select");
    feedSelect.className = "automation-mt-half";
    feeds.forEach((f) => {
      feedSelect.appendChild(this.createOption(f.id, f.title));
    });
    feedSelect.value = currentRule.conditionValue;
    feedSelect.onchange = (e) => (currentRule.conditionValue = e.target.value);

    const updateConditionInput = () => {
      conditionValueInput.classList.add("automation-hidden");
      feedSelect.classList.add("automation-hidden");

      const needsTextInput = [
        "title_contains",
        "content_contains",
        "url_contains",
      ].includes(conditionSelect.value);
      const needsFeedSelect = ["feed_is"].includes(conditionSelect.value);

      if (needsTextInput) {
        conditionValueInput.classList.remove("automation-hidden");
        conditionValueInput.value = currentRule.conditionValue;
      } else if (needsFeedSelect) {
        feedSelect.classList.remove("automation-hidden");
        if (!currentRule.conditionValue && feeds.length > 0) {
          currentRule.conditionValue = feeds[0].id;
          feedSelect.value = feeds[0].id;
        } else {
          feedSelect.value = currentRule.conditionValue;
        }
      } else {
        currentRule.conditionValue = "";
      }
    };

    conditionSelect.onchange = (e) => {
      currentRule.condition = e.target.value;
      updateConditionInput();
    };

    conditionGroup.appendChild(conditionRow);
    conditionGroup.appendChild(conditionValueInput);
    conditionGroup.appendChild(feedSelect);
    form.appendChild(conditionGroup);
    updateConditionInput();

    // Action
    const actionGroup = this.createFormGroup("Action");
    const actionSelect = document.createElement("select");
    actionSelect.appendChild(this.createOption("discard", "Discard Article"));
    actionSelect.appendChild(this.createOption("mark_read", "Mark as Read"));
    actionSelect.appendChild(this.createOption("favorite", "Mark as Favorite"));
    actionSelect.appendChild(this.createOption("notify", "Show Notification"));

    actionSelect.value = currentRule.action;
    actionSelect.onchange = (e) => (currentRule.action = e.target.value);
    actionGroup.appendChild(actionSelect);
    form.appendChild(actionGroup);

    // Buttons
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

      const needsTextInput = [
        "title_contains",
        "content_contains",
        "url_contains",
      ].includes(currentRule.condition);
      const needsFeedSelect = ["feed_is"].includes(currentRule.condition);

      if (needsTextInput) {
        currentRule.conditionValue = conditionValueInput.value;
      } else if (needsFeedSelect) {
        currentRule.conditionValue = feedSelect.value;
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
