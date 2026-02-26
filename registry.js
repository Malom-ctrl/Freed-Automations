export async function activate(api) {
  class AutomationRegistry {
    constructor() {
      this.events = new Map();
      this.conditions = new Map();
      this.actions = new Map();
    }

    registerEvent(eventDef) {
      this.events.set(eventDef.id, eventDef);
    }

    registerCondition(conditionDef) {
      this.conditions.set(conditionDef.id, conditionDef);
    }

    registerAction(actionDef) {
      this.actions.set(actionDef.id, actionDef);
    }

    getEvent(id) {
      return this.events.get(id);
    }

    getCondition(id) {
      return this.conditions.get(id);
    }

    getAction(id) {
      return this.actions.get(id);
    }

    getEvents() {
      return Array.from(this.events.values());
    }

    getConditions(targetType) {
      return Array.from(this.conditions.values()).filter(c => 
        !c.compatibleTargetTypes || c.compatibleTargetTypes.includes(targetType)
      );
    }

    getActions(targetType) {
      return Array.from(this.actions.values()).filter(a => 
        !a.compatibleTargetTypes || a.compatibleTargetTypes.includes(targetType)
      );
    }
  }

  api.namespace.register("AutomationRegistry", AutomationRegistry);
}
