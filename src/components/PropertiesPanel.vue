<script setup>
import { computed, ref } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import draggable from 'vuedraggable'

/**
 * 组件：PropertiesPanel (右侧属性编辑面板)
 * 作用：根据用户选中的对象（时间轴上的动作块 OR 技能库里的图标），显示并编辑其属性。
 * 模式：
 * 1. 实例模式 (Instance Mode): 选中了 TimelineGrid 上的某个块，修改的是该块的独立数据。
 * 2. 库模式 (Library Mode): 选中了 ActionLibrary 里的图标，修改的是该技能的全局基础数值。
 */

const store = useTimelineStore()

const EFFECT_NAMES = {
  "break": "破防", "armor_break": "碎甲", "stagger": "猛击", "knockdown": "倒地", "knockup": "击飞",
  "blaze_attach": "灼热附着", "emag_attach": "电磁附着", "cold_attach": "寒冷附着", "nature_attach": "自然附着",
  "blaze_burst": "灼热爆发", "emag_burst": "电磁爆发", "cold_burst": "寒冷爆发", "nature_burst": "自然爆发",
  "burning": "燃烧", "conductive": "导电", "frozen": "冻结", "ice_shatter": "碎冰", "corrosion": "腐蚀",
  "default": "默认图标"
}

// === 库模式逻辑 ===
const selectedLibrarySkill = computed(() => {
  if (!store.selectedLibrarySkillId) return null
  return store.activeSkillLibrary.find(s => s.id === store.selectedLibrarySkillId)
})

function updateLibraryProp(key, value) {
  if (!selectedLibrarySkill.value) return
  store.updateLibrarySkill(selectedLibrarySkill.value.id, { [key]: value })
}

// === 动作实例模式逻辑 ===
const selectedAction = computed(() => {
  if (!store.selectedActionId) return null
  // 遍历所有轨道查找该 ID
  for (const track of store.tracks) {
    const found = track.actions.find(a => a.instanceId === store.selectedActionId)
    if (found) return found
  }
  return null
})

// 获取当前动作所属的干员信息 (用于读取专属 Buff)
const currentCharacter = computed(() => {
  if (!selectedAction.value) return null;
  const track = store.tracks.find(t => t.actions.some(a => a.instanceId === store.selectedActionId));
  if (!track) return null;
  return store.characterRoster.find(c => c.id === track.id);
})

/**
 * 辅助计算属性：智能推断当前选中的技能类型
 * 用于动态显示/隐藏某些字段（例如 Ultimate 才显示充能消耗）
 */
const currentSkillType = computed(() => {
  if (selectedLibrarySkill.value) return selectedLibrarySkill.value.type;
  if (selectedAction.value) return selectedAction.value.type;
  return 'unknown';
});

const editingEffectIndex = ref(null)

/**
 * 构建异常状态图标下拉框选项
 * 逻辑：
 * 1. 获取所有全局图标。
 * 2. 根据动作的 allowedTypes 过滤可选图标（如果 allowedTypes 为空则全选）。
 * 3. 插入当前角色的“专属 Buff” (Exclusive Buffs)。
 */
const iconOptions = computed(() => {
  const allGlobalKeys = Object.keys(store.iconDatabase);
  const allowed = selectedAction.value?.allowedTypes;

  // 1. 过滤全局图标
  const filteredGlobalKeys = (allowed && allowed.length > 0)
      ? allGlobalKeys.filter(key => allowed.includes(key) || key === 'default')
      : allGlobalKeys;

  const globalOptions = filteredGlobalKeys.map(key => ({
    label: EFFECT_NAMES[key] || key, value: key, path: store.iconDatabase[key]
  }));

  // 2. 处理专属 Buff
  let exclusiveOptions = [];
  if (currentCharacter.value && currentCharacter.value.exclusive_buffs) {
    exclusiveOptions = currentCharacter.value.exclusive_buffs.map(buff => ({
      label: `★ ${buff.name}`, value: buff.key, path: buff.path
    }));
    if (allowed && allowed.length > 0) {
      exclusiveOptions = exclusiveOptions.filter(opt => allowed.includes(opt.value));
    }
  }

  return [...exclusiveOptions, ...globalOptions];
})

/**
 * 计算与当前选中动作相关的连线 (Incoming & Outgoing)
 * 用于显示“现有连线”列表，并提供快速删除功能。
 */
const relevantConnections = computed(() => {
  if (!store.selectedActionId) return []
  return store.connections.filter(c => c.from === store.selectedActionId || c.to === store.selectedActionId)
      .map(conn => {
        const isOutgoing = conn.from === store.selectedActionId
        const otherActionId = isOutgoing ? conn.to : conn.from
        let otherActionName = '未知动作';
        // 查找对方动作的名称
        for (const track of store.tracks) {
          const action = track.actions.find(a => a.instanceId === otherActionId)
          if (action) { otherActionName = action.name; break; }
        }
        return { id: conn.id, direction: isOutgoing ? '连向' : '来自', otherActionName, isOutgoing }
      })
})

function getIconPath(type) {
  if (currentCharacter.value && currentCharacter.value.exclusive_buffs) {
    const exclusive = currentCharacter.value.exclusive_buffs.find(b => b.key === type);
    if (exclusive) return exclusive.path;
  }
  return store.iconDatabase[type] || store.iconDatabase['default'] || ''
}

// === 通用更新方法 ===
function updateActionProp(key, value) { if (!selectedAction.value) return; store.updateAction(store.selectedActionId, { [key]: value }); }
function updateAnomaliesList(newList) { if (!selectedAction.value) return; store.updateAction(store.selectedActionId, { physicalAnomaly: newList }) }
function updateEffectProp(index, key, value) {
  const list = [...selectedAction.value.physicalAnomaly]; list[index][key] = value;
  store.updateAction(store.selectedActionId, { physicalAnomaly: list })
}

// === 异常状态操作 ===
function addEffect() {
  const list = [...(selectedAction.value.physicalAnomaly || [])]; list.push({ type: 'default', stacks: 1, duration: 0 });
  store.updateAction(store.selectedActionId, { physicalAnomaly: list }); editingEffectIndex.value = list.length - 1;
}
function removeEffect(index) {
  const list = [...selectedAction.value.physicalAnomaly]; list.splice(index, 1);
  store.updateAction(store.selectedActionId, { physicalAnomaly: list });
  if (editingEffectIndex.value === index) editingEffectIndex.value = null;
}
// v-model 绑定的计算属性，用于 draggable 组件
const anomalyList = computed({ get: () => selectedAction.value?.physicalAnomaly || [], set: (val) => updateAnomaliesList(val) })
</script>

<template>
  <div v-if="selectedAction" class="properties-panel">
    <h3 class="panel-title">动作实例编辑</h3>
    <div class="type-tag">{{ selectedAction.name }} ({{ currentSkillType }})</div>

    <button class="link-btn" @click.stop="store.startLinking()" :class="{ 'is-linking': store.isLinking && store.linkingEffectIndex === null }">
      {{ (store.isLinking && store.linkingEffectIndex === null) ? '请点击目标动作块...' : '🔗 建立连线' }}
    </button>

    <div class="attribute-editor">
      <div class="form-group">
        <label>持续时间 (Duration)</label>
        <input type="number" :value="selectedAction.duration" @input="e => updateActionProp('duration', Number(e.target.value))" step="0.1">
      </div>

      <div class="form-group" v-if="currentSkillType === 'link'">
        <label>冷却时间 (Cooldown)</label>
        <input type="number" :value="selectedAction.cooldown" @input="e => updateActionProp('cooldown', Number(e.target.value))">
      </div>

      <div class="form-group highlight" v-if="currentSkillType === 'skill'">
        <label>技力消耗 (SP Cost)</label>
        <input type="number" :value="selectedAction.spCost" @input="e => updateActionProp('spCost', Number(e.target.value))">
      </div>

      <div class="form-group highlight-blue" v-if="currentSkillType === 'ultimate'">
        <label>充能消耗 (Gauge Cost)</label>
        <input type="number" :value="selectedAction.gaugeCost" @input="e => updateActionProp('gaugeCost', Number(e.target.value))">
      </div>

      <div class="form-group highlight">
        <label>技力回复/返还 (SP Gain)</label>
        <input type="number" :value="selectedAction.spGain" @input="e => updateActionProp('spGain', Number(e.target.value))">
      </div>

      <div class="form-group highlight-blue">
        <label>充能回复 (Gauge Gain)</label>
        <input type="number" :value="selectedAction.gaugeGain" @input="e => updateActionProp('gaugeGain', Number(e.target.value))">
      </div>
    </div>

    <div v-if="relevantConnections.length > 0" class="connections-list-area">
      <div class="info-row"><label>现有连线</label></div>
      <div v-for="conn in relevantConnections" :key="conn.id" class="connection-item" :class="{ 'is-outgoing': conn.isOutgoing, 'is-incoming': !conn.isOutgoing }">
        <span class="conn-icon">{{ conn.isOutgoing ? '➔' : '←' }}</span>
        <span class="conn-text">{{ conn.direction }} {{ conn.otherActionName }}</span>
        <div class="delete-conn-btn" @click="store.removeConnection(conn.id)" title="断开连线">×</div>
      </div>
    </div>

    <hr class="divider" />

    <div class="info-row" style="margin-bottom: 5px;">
      <label>状态效果 (可拖拽排序)</label>
      <div class="add-icon-btn" @click="addEffect" title="添加效果">+</div>
    </div>

    <div class="icon-stream-container">
      <draggable v-model="anomalyList" item-key="type" class="icon-list" :animation="200" ghost-class="ghost-icon">
        <template #item="{ element, index }">
          <div class="icon-wrapper" :class="{ 'is-editing': editingEffectIndex === index }" @click="editingEffectIndex = index">
            <img :src="getIconPath(element.type)" class="mini-icon" />
            <div v-if="element.stacks > 1" class="mini-stacks">{{ element.stacks }}</div>
          </div>
        </template>
      </draggable>
    </div>

    <div v-if="editingEffectIndex !== null && selectedAction.physicalAnomaly[editingEffectIndex]" class="effect-detail-editor">
      <div class="editor-header">
        <span>编辑 #{{ editingEffectIndex + 1 }}</span>
        <button class="close-btn" @click="editingEffectIndex = null">×</button>
      </div>
      <div class="form-row full-width">
        <label>类型</label>
        <select :value="selectedAction.physicalAnomaly[editingEffectIndex].type" @change="e => updateEffectProp(editingEffectIndex, 'type', e.target.value)">
          <option v-for="opt in iconOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div class="form-row">
        <label>层数</label>
        <input type="number" :value="selectedAction.physicalAnomaly[editingEffectIndex].stacks" @input="e => updateEffectProp(editingEffectIndex, 'stacks', Number(e.target.value))" min="1">
      </div>
      <div class="form-row">
        <label>持续(s)</label>
        <input type="number" :value="selectedAction.physicalAnomaly[editingEffectIndex].duration" @input="e => updateEffectProp(editingEffectIndex, 'duration', Number(e.target.value))" min="0" step="0.5">
      </div>
      <div class="editor-footer">
        <button class="effect-link-btn" @click.stop="store.startLinking(editingEffectIndex)" :class="{ 'is-linking': store.isLinking && store.linkingEffectIndex === editingEffectIndex }">
          🔗 连线
        </button>
        <button class="delete-btn-small" @click="removeEffect(editingEffectIndex)">删除</button>
      </div>
    </div>
  </div>

  <div v-else-if="selectedLibrarySkill" class="properties-panel library-mode">
    <h3 class="panel-title" style="color: #4a90e2;">基础数值调整</h3>
    <div class="panel-desc">
      修改 <strong>{{ selectedLibrarySkill.name }}</strong> 的基础属性。<br/>
      此修改将同步更新所有同类技能（全局生效）。
    </div>

    <div class="attribute-editor">
      <div class="form-group">
        <label>持续时间 (Duration)</label>
        <input type="number" :value="selectedLibrarySkill.duration" @input="e => updateLibraryProp('duration', Number(e.target.value))" min="0.5" step="0.5">
      </div>

      <div class="form-group" v-if="currentSkillType === 'link'">
        <label>冷却时间 (Cooldown)</label>
        <input type="number" :value="selectedLibrarySkill.cooldown" @input="e => updateLibraryProp('cooldown', Number(e.target.value))" min="0">
      </div>

      <div class="form-group highlight" v-if="currentSkillType === 'skill'">
        <label>技力消耗 (SP Cost)</label>
        <input type="number" :value="selectedLibrarySkill.spCost" @input="e => updateLibraryProp('spCost', Number(e.target.value))" min="0">
      </div>

      <div class="form-group highlight-blue" v-if="currentSkillType === 'ultimate'">
        <label>充能消耗 (Gauge Cost)</label>
        <input type="number" :value="selectedLibrarySkill.gaugeCost" @input="e => updateLibraryProp('gaugeCost', Number(e.target.value))" min="0">
      </div>

      <div class="form-group highlight">
        <label>技力回复/返还 (SP Gain)</label>
        <input type="number" :value="selectedLibrarySkill.spGain" @input="e => updateLibraryProp('spGain', Number(e.target.value))" min="0">
      </div>

      <div class="form-group highlight-blue">
        <label>充能回复 (Gauge Gain)</label>
        <input type="number" :value="selectedLibrarySkill.gaugeGain" @input="e => updateLibraryProp('gaugeGain', Number(e.target.value))" min="0">
      </div>
    </div>

    <div class="info-box">
      <p>💡 提示：点击左侧相同技能块可取消选中。</p>
    </div>
  </div>

  <div v-else class="properties-panel empty">
    <p>请选中一个动作块或技能库图标</p>
  </div>
</template>

<style scoped>
/* ============================ */
/* 基础布局样式 (保持不变) */
/* ============================ */
.properties-panel { padding: 15px; color: #e0e0e0; background-color: #2b2b2b; height: 100%; box-sizing: border-box; overflow-y: auto; border-left: 1px solid #444; font-size: 14px; }
.attribute-editor { border: 1px solid #444; padding: 10px; border-radius: 6px; margin-bottom: 15px; background: #333; }
.panel-title { color: #ffd700; margin-top: 0; margin-bottom: 10px; }
.type-tag { font-size: 12px; color: #888; margin-bottom: 15px; font-style: italic; }

.form-group { margin-bottom: 12px; }
.form-group label { display: block; margin-bottom: 4px; font-size: 12px; color: #bbb; }
input, select { width: 100%; box-sizing: border-box; background: #222; color: white; border: 1px solid #555; padding: 6px; border-radius: 4px; }
input:focus, select:focus { border-color: #ffd700; outline: none; }

/* 高亮样式 */
.highlight input { border-color: #ffd700; color: #ffd700; }
.highlight-blue input { border-color: #00e5ff; color: #00e5ff; }

/* 按钮样式 */
.link-btn { width: 100%; padding: 8px; margin-bottom: 10px; background-color: #444; color: #ffd700; border: 1px solid #ffd700; border-radius: 4px; cursor: pointer; font-weight: bold; }
.link-btn:hover { background-color: #555; }
.link-btn.is-linking { background-color: #ffd700; color: #000; animation: pulse 1s infinite; }
.delete-conn-btn { cursor: pointer; color: #aaa; font-weight: bold; padding: 0 5px; } .delete-conn-btn:hover { color: #d32f2f; }
.connection-item { display: flex; justify-content: space-between; align-items: center; background-color: #3a3a3a; padding: 8px; border-radius: 4px; margin-bottom: 5px; border-left: 3px solid transparent; }
.connection-item.is-outgoing { border-left-color: #ffd700; }
.connection-item.is-incoming { border-left-color: #00e5ff; }

/* ============================ */
/* 图标流样式 (紧凑版) */
/* ============================ */
.info-row { display: flex; justify-content: space-between; align-items: center; color: #aaa; font-size: 12px; }
.add-icon-btn { cursor: pointer; color: #777; font-size: 16px; border: 1px dashed #777; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 4px; padding-bottom: 3px; }
.add-icon-btn:hover { border-color: #ffd700; color: #ffd700; }

.icon-stream-container { background: #333; padding: 8px; border-radius: 6px; border: 1px solid #444; min-height: 45px; margin-top: 5px;}
.icon-list { display: flex; flex-wrap: wrap; gap: 6px; }
.icon-wrapper { position: relative; width: 36px; height: 36px; background: #444; border: 1px solid #666; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
.icon-wrapper:hover { border-color: #999; background: #555; }
.icon-wrapper.is-editing { border-color: #ffd700; background: #4a4a3a; box-shadow: 0 0 4px rgba(255, 215, 0, 0.3); }
.mini-icon { width: 24px; height: 24px; object-fit: contain; }
.mini-stacks { position: absolute; bottom: 0; right: 0; background: rgba(0,0,0,0.8); color: #fff; font-size: 9px; padding: 0 2px; line-height: 1; border-radius: 2px; }
.ghost-icon { opacity: 0.5; background: #ffd700; }

/* 效果编辑卡片 */
.effect-detail-editor { margin-top: 10px; background: #383838; padding: 10px; border-radius: 6px; border: 1px solid #555; animation: fadeIn 0.2s ease; }
.editor-header { display: flex; justify-content: space-between; margin-bottom: 8px; color: #ffd700; font-size: 12px; font-weight: bold; }
.close-btn { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; line-height: 1; padding: 0; }
.form-row { display: flex; flex-direction: column; margin-bottom: 8px; }
.form-row.full-width { grid-column: 1 / -1; }
.form-row label { font-size: 11px; color: #999; margin-bottom: 2px; }
.form-row input, .form-row select { font-size: 12px; padding: 4px; }
.editor-footer { display: flex; gap: 8px; }
.effect-link-btn { flex-grow: 1; background: #444; border: 1px dashed #ffd700; color: #ffd700; font-size: 12px; padding: 4px; cursor: pointer; border-radius: 4px; }
.effect-link-btn.is-linking { background-color: #ffd700; color: #000; border-style: solid; animation: pulse 1s infinite; }
.delete-btn-small { background: #d32f2f; border: none; color: white; font-size: 12px; padding: 4px 10px; cursor: pointer; border-radius: 4px; }

/* 库模式 */
.library-mode .attribute-editor { border-color: #4a90e2; }
.panel-desc { font-size: 12px; color: #aaa; margin-bottom: 20px; padding: 8px; background: rgba(74, 144, 226, 0.1); border-left: 2px solid #4a90e2; }
.info-box { margin-top: 20px; font-size: 12px; color: #666; text-align: center; }
.empty { display: flex; align-items: center; justify-content: center; color: #666; }
.divider { border: 0; border-top: 1px solid #444; margin: 15px 0; }

@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.7; } 100% { opacity: 1; } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
</style>