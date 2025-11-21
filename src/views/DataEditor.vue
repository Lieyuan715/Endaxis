<script setup>
import { onMounted } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import { storeToRefs } from 'pinia'

/**
 * 组件：DataEditor (数据编辑器)
 * 作用：一个内置的 CMS (Content Management System)，用于可视化的管理 gamedata.json。
 * 核心功能：
 * 1. 加载并显示所有干员数据。
 * 2. 修改干员的基础属性、技能数值、资源消耗。
 * 3. 编辑“允许挂载的异常状态” (Allowed Buffs)，并包含智能联动逻辑。
 * 4. 导出修改后的 JSON 文件。
 */

const store = useTimelineStore()
const { characterRoster, iconDatabase, isLoading } = storeToRefs(store)

// 异常状态映射表 (Key -> 中文名)
const EFFECT_NAMES = {
  "break": "破防", "armor_break": "碎甲", "stagger": "猛击", "knockdown": "倒地", "knockup": "击飞",
  "blaze_attach": "灼热附着", "emag_attach": "电磁附着", "cold_attach": "寒冷附着", "nature_attach": "自然附着",
  "blaze_burst": "灼热爆发", "emag_burst": "电磁爆发", "cold_burst": "寒冷爆发", "nature_burst": "自然爆发",
  "burning": "燃烧", "conductive": "导电", "frozen": "冻结", "ice_shatter": "碎冰", "corrosion": "腐蚀",
  "default": "默认图标"
}
const effectKeys = Object.keys(EFFECT_NAMES);

onMounted(async () => {
  if (characterRoster.value.length === 0) {
    await store.fetchGameData()
  }

  // === 数据清洗与迁移 (Migration) ===
  // 确保加载的旧版本 JSON 数据也能兼容当前系统，自动填充缺失字段
  characterRoster.value.forEach(char => {
    // 资源系统默认值
    if (char.ultimate_gaugeMax === undefined) char.ultimate_gaugeMax = 100;
    if (char.skill_spCost === undefined) char.skill_spCost = 100;
    if (char.skill_spReply === undefined) char.skill_spReply = 0;
    if (char.ultimate_spReply === undefined) char.ultimate_spReply = 0;
    if (char.ultimate_gaugeReply === undefined) char.ultimate_gaugeReply = 0;
    if (char.skill_gaugeGain === undefined) char.skill_gaugeGain = 0;
    if (char.link_gaugeGain === undefined) char.link_gaugeGain = 0;
    if (char.execution_duration === undefined) char.execution_duration = 1.5;
    if (char.execution_spGain === undefined) char.execution_spGain = 20;

    // 数组结构默认值
    if (!Array.isArray(char.exclusive_buffs)) char.exclusive_buffs = [];
    const skills = ['attack','execution', 'skill', 'link', 'ultimate'];
    skills.forEach(s => {
      if (!Array.isArray(char[`${s}_allowed_types`])) char[`${s}_allowed_types`] = [];
      if (!Array.isArray(char[`${s}_anomalies`])) char[`${s}_anomalies`] = [];
    })
  })
})

/**
 * 复选框变更处理 (含智能联动)
 * @param {Object} char 干员对象
 * @param {string} skillType 技能类型 (attack/skill/link/ultimate)
 * @param {string} key 异常状态 Key
 */
function onCheckChange(char, skillType, key) {
  const fieldName = `${skillType}_allowed_types`;
  const list = char[fieldName];
  const isChecked = list.includes(key);

  // 联动规则 1: 元素组联动 (Elemental Group Linkage)
  // 例如：勾选 'burning' (燃烧)，自动勾选 'blaze_attach' 和 'blaze_burst'。
  // 反之，取消勾选时，自动取消同组所有 Tag。
  const elementalGroups = [
    ['burning', 'blaze_attach', 'blaze_burst'],
    ['conductive', 'emag_attach', 'emag_burst'],
    ['frozen', 'cold_attach', 'cold_burst'],
    ['corrosion', 'nature_attach', 'nature_burst']
  ];

  const group = elementalGroups.find(g => g.includes(key));
  if (group) {
    if (isChecked) {
      // 自动补全同组
      group.forEach(item => { if (!list.includes(item)) list.push(item); });
    } else {
      // 自动移除同组
      char[fieldName] = list.filter(item => !group.includes(item));
      return;
    }
  }

  // 联动规则 2: 物理控制联动 (Physical Control Linkage)
  // 如果勾选了高级控制 (击飞/倒地)，自动允许基础控制 (破防/碎冰)。
  if (isChecked) {
    const physicalTriggers = ['knockup', 'knockdown', 'stagger','armor_break'];
    if (physicalTriggers.includes(key)) {
      if (!list.includes('break')) list.push('break');
      if (!list.includes('ice_shatter')) list.push('ice_shatter');
    }
  }
}

function saveData() {
  // 按稀有度降序排列，方便在排轴器中查找
  characterRoster.value.sort((a, b) => (b.rarity || 0) - (a.rarity || 0));

  // 组装最终 JSON 结构
  const dataToSave = {
    SYSTEM_CONSTANTS: { MAX_SP: 300, SP_REGEN_PER_SEC: 8, SKILL_SP_COST_DEFAULT: 100 },
    ICON_DATABASE: iconDatabase.value,
    characterRoster: characterRoster.value
  }

  // 创建 Blob 并下载
  const jsonData = JSON.stringify(dataToSave, null, 2)
  const blob = new Blob([jsonData], {type: 'application/json'})
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'gamedata.json'
  link.click()
  URL.revokeObjectURL(link.href)

  alert('gamedata.json 生成成功！\n请将其覆盖项目中的 public/gamedata.json 文件以应用更改。')
}

function addNewCharacter() {
  const newId = `char_${Date.now()}`;
  const newChar = {
    id: newId, name: "新干员", rarity: 6, avatar: "/avatars/default.png", exclusive_buffs: [],
    // 重击
    attack_duration: 2.5, attack_spGain: 15, attack_allowed_types: [], attack_anomalies: [],
    // 战技 (默认无CD, 消耗SP)
    skill_duration: 2, skill_spCost: 100, skill_spReply: 0, skill_gaugeGain: 0,
    skill_allowed_types: [], skill_anomalies: [],
    // 连携
    link_duration: 1, link_cooldown: 1, link_spCost: 0, link_spGain: 0, link_gaugeGain: 0,
    link_allowed_types: [], link_anomalies: [],
    // 终结技 (默认消耗充能)
    ultimate_duration: 4, ultimate_gaugeMax: 1000, ultimate_spReply: 0, ultimate_gaugeReply: 0,
    ultimate_allowed_types: [], ultimate_anomalies: [],
    // 处决
    execution_duration: 1.5, execution_spGain: 20, execution_allowed_types: [], execution_anomalies: []
  };
  characterRoster.value.push(newChar);
  // 滚动到底部查看新干员
  setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); }, 100);
}
</script>

<template>
  <div class="editor-container">
    <header class="editor-header">
      <h1>数据编辑器</h1>
      <p><router-link to="/">返回主排轴器</router-link></p>
      <div class="button-group">
        <button @click="saveData" class="save-button">生成并下载 gamedata.json</button>
        <button @click="addNewCharacter" class="add-button">添加新干员</button>
      </div>
    </header>

    <div v-if="isLoading">正在加载数据...</div>

    <section v-if="!isLoading" class="data-section">
      <div v-for="character in characterRoster" :key="character.id" class="item-card">
        <div class="card-header"><h3>{{ character.name }}</h3><span class="rarity-badge">{{ character.rarity }} ★</span></div>

        <div class="form-grid">
          <div class="form-field"><label>ID (唯一标识)</label><input type="text" v-model="character.id"></div>
          <div class="form-field"><label>Name (显示名称)</label><input type="text" v-model="character.name"></div>
          <div class="form-field"><label>Rarity (星级)</label><input type="number" v-model.number="character.rarity" min="1" max="6"></div>
          <div class="form-field"><label>Avatar (头像路径)</label><input type="text" v-model="character.avatar"></div>

          <div class="form-field full-width">
            <label>专属 Buff (Exclusive Buffs)</label>
            <div class="anomalies-list-editor">
              <div v-for="(buff, idx) in character.exclusive_buffs" :key="idx" class="anomaly-row-edit">
                <input type="text" v-model="buff.key" placeholder="Key (e.g. crystallize)" class="input-small">
                <input type="text" v-model="buff.name" placeholder="名称" class="input-small">
                <input type="text" v-model="buff.path" placeholder="/icons/..." class="input-wide">
                <button @click="character.exclusive_buffs.splice(idx, 1)" class="btn-del">×</button>
              </div>
              <button @click="character.exclusive_buffs.push({ key: '', name: '', path: '' })" class="btn-add-row">+ 添加专属 Buff</button>
            </div>
          </div>
        </div>

        <hr>
        <h4>⚔️ 重击 (Attack)</h4>
        <div class="form-grid">
          <div class="form-field"><label>Duration (s)</label><input type="number" v-model.number="character.attack_duration" step="0.1"></div>
          <div class="form-field highlight"><label>SP Gain</label><input type="number" v-model.number="character.attack_spGain"></div>
          <div class="form-field full-width"><label>允许的 Buff</label>
            <div class="checkbox-group-container">
              <label v-for="key in effectKeys" :key="key" class="checkbox-label">
                <input type="checkbox" :value="key" v-model="character.attack_allowed_types" @change="onCheckChange(character, 'attack', key)">
                {{ EFFECT_NAMES[key] }}
              </label>
              <label v-for="buff in character.exclusive_buffs" :key="buff.key" class="checkbox-label" style="color: #ffd700;">
                <input type="checkbox" :value="buff.key" v-model="character.attack_allowed_types" @change="onCheckChange(character, 'attack', buff.key)">
                ★ {{ buff.name }}
              </label>
            </div>
          </div>
        </div>

        <hr>
        <h4>☠️ 处决 (Execution) - 无CD，回复技力</h4>
        <div class="form-grid">
          <div class="form-field"><label>Duration (s)</label><input type="number" v-model.number="character.execution_duration" step="0.1"></div>
          <div class="form-field highlight"><label>SP Gain (回复)</label><input type="number" v-model.number="character.execution_spGain"></div>
          <div class="form-field full-width"><label>允许的 Buff</label>
            <div class="checkbox-group-container">
              <label v-for="key in effectKeys" :key="key" class="checkbox-label">
                <input type="checkbox" :value="key" v-model="character.execution_allowed_types" @change="onCheckChange(character, 'execution', key)">
                {{ EFFECT_NAMES[key] }}
              </label>
              <label v-for="buff in character.exclusive_buffs" :key="buff.key" class="checkbox-label" style="color: #ffd700;">
                <input type="checkbox" :value="buff.key" v-model="character.execution_allowed_types" @change="onCheckChange(character, 'execution', buff.key)">
                ★ {{ buff.name }}
              </label>
            </div>
          </div>
        </div>

        <hr>
        <h4>⚡ 战技 (Skill) - 无CD，消耗技力</h4>
        <div class="form-grid">
          <div class="form-field"><label>Duration (s)</label><input type="number" v-model.number="character.skill_duration" step="0.1"></div>
          <div class="form-field highlight"><label>SP Cost</label><input type="number" v-model.number="character.skill_spCost"></div>
          <div class="form-field highlight"><label>SP Refund</label><input type="number" v-model.number="character.skill_spReply"></div>
          <div class="form-field highlight-blue"><label>Gauge Gain</label><input type="number" v-model.number="character.skill_gaugeGain"></div>
          <div class="form-field full-width"><label>允许的 Buff</label>
            <div class="checkbox-group-container">
              <label v-for="key in effectKeys" :key="key" class="checkbox-label">
                <input type="checkbox" :value="key" v-model="character.skill_allowed_types" @change="onCheckChange(character, 'skill', key)">
                {{ EFFECT_NAMES[key] }}
              </label>
              <label v-for="buff in character.exclusive_buffs" :key="buff.key" class="checkbox-label" style="color: #ffd700;">
                <input type="checkbox" :value="buff.key" v-model="character.skill_allowed_types" @change="onCheckChange(character, 'skill', buff.key)">
                ★ {{ buff.name }}
              </label>
            </div>
          </div>
        </div>

        <hr>
        <h4>🔗 连携 (Link)</h4>
        <div class="form-grid">
          <div class="form-field"><label>Duration (s)</label><input type="number" v-model.number="character.link_duration" step="0.1"></div>
          <div class="form-field"><label>Cooldown (s)</label><input type="number" v-model.number="character.link_cooldown"></div>
          <div class="form-field highlight"><label>SP Gain (回能)</label><input type="number" v-model.number="character.link_spGain"></div>
          <div class="form-field highlight-blue"><label>Gauge Gain</label><input type="number" v-model.number="character.link_gaugeGain"></div>
          <div class="form-field full-width"><label>允许的 Buff</label>
            <div class="checkbox-group-container">
              <label v-for="key in effectKeys" :key="key" class="checkbox-label">
                <input type="checkbox" :value="key" v-model="character.link_allowed_types" @change="onCheckChange(character, 'link', key)">
                {{ EFFECT_NAMES[key] }}
              </label>
              <label v-for="buff in character.exclusive_buffs" :key="buff.key" class="checkbox-label" style="color: #ffd700;">
                <input type="checkbox" :value="buff.key" v-model="character.link_allowed_types" @change="onCheckChange(character, 'link', buff.key)">
                ★ {{ buff.name }}
              </label>
            </div>
          </div>
        </div>

        <hr>
        <h4>🌟 终结技 (Ultimate) - 消耗充能</h4>
        <div class="form-grid">
          <div class="form-field"><label>Duration (s)</label><input type="number" v-model.number="character.ultimate_duration" step="0.1"></div>
          <div class="form-field highlight-blue"><label>Gauge Max (Cost)</label><input type="number" v-model.number="character.ultimate_gaugeMax"></div>
          <div class="form-field highlight"><label>SP Reply</label><input type="number" v-model.number="character.ultimate_spReply"></div>
          <div class="form-field highlight-blue"><label>Gauge Reply</label><input type="number" v-model.number="character.ultimate_gaugeReply"></div>
          <div class="form-field full-width"><label>允许的 Buff</label>
            <div class="checkbox-group-container">
              <label v-for="key in effectKeys" :key="key" class="checkbox-label">
                <input type="checkbox" :value="key" v-model="character.ultimate_allowed_types" @change="onCheckChange(character, 'ultimate', key)">
                {{ EFFECT_NAMES[key] }}
              </label>
              <label v-for="buff in character.exclusive_buffs" :key="buff.key" class="checkbox-label" style="color: #ffd700;">
                <input type="checkbox" :value="buff.key" v-model="character.ultimate_allowed_types" @change="onCheckChange(character, 'ultimate', buff.key)">
                ★ {{ buff.name }}
              </label>
            </div>
          </div>
        </div>

      </div>
    </section>
  </div>
</template>

<style scoped>
.editor-container { padding: 20px; color: #f0f0f0; background-color: #2c2c2c; height: 100vh; overflow-y: auto; box-sizing: border-box; }
.editor-header { border-bottom: 1px solid #555; padding-bottom: 20px; }
.editor-header a { color: #4a90e2; }
.button-group { display: flex; gap: 15px; margin: 20px 0; }
.save-button { background-color: #4CAF50; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
.add-button { background-color: #008CBA; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
.data-section { margin-top: 30px; }
.item-card { background-color: #3a3a3a; border: 1px solid #555; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.rarity-badge { background-color: #ffd700; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; }
hr { border: 0; border-top: 1px solid #555; margin: 20px 0; }
h4 { color: #f0f0f0; border-bottom: 1px solid #777; padding-bottom: 5px; margin-top: 10px; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; }
.form-field { display: flex; flex-direction: column; }
.form-field.full-width { grid-column: 1 / -1; }
.form-field label { margin-bottom: 5px; color: #aaa; font-size: 12px; }
.form-field input { background-color: #2c2c2c; color: #f0f0f0; border: 1px solid #555; border-radius: 4px; padding: 8px; font-size: 16px; }

/* 资源高亮样式 */
.highlight input { border-color: #ffd700; color: #ffd700; } /* SP 相关 */
.highlight-blue input { border-color: #00e5ff; color: #00e5ff; } /* 充能 相关 */

/* 复选框和列表的样式保持原样 */
.checkbox-group-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; background: #222; padding: 10px; border: 1px solid #555; border-radius: 4px; }
.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; user-select: none; }
.anomalies-list-editor { background: #222; padding: 10px; border: 1px solid #555; border-radius: 4px; display: flex; flex-direction: column; gap: 8px; }
.anomaly-row-edit { display: flex; align-items: center; gap: 8px; background: #333; padding: 5px; border-radius: 4px; }
.btn-del { background: #d32f2f; color: white; border: none; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-weight: bold; }
.btn-add-row { background: #444; color: #ffd700; border: 1px dashed #ffd700; padding: 8px; cursor: pointer; border-radius: 4px; }
.input-tiny { width: 50px !important; padding: 4px !important; text-align: center; }
.input-small { width: 120px !important; }
.input-wide { flex-grow: 1; }
</style>