import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// 简单的 UUID 生成器
const uid = () => Math.random().toString(36).substring(2, 9)

export const useTimelineStore = defineStore('timeline', () => {

    // === 常量定义 ===
    const SP_MAX = 300
    const SP_REGEN_RATE = 8
    const BASE_BLOCK_WIDTH = 50 // 基础宽度：1秒 = 50px
    const TOTAL_DURATION = 120

    // === 基础状态 (State) ===
    const characterRoster = ref([]) // 完整的干员数据库
    const isLoading = ref(true)
    const iconDatabase = ref({})    // 图标路径映射表

    // 核心数据：4条轨道，每条包含已放置的 actions 和当前选择的干员 ID
    const tracks = ref([
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
    ])

    const connections = ref([]) // 连线数据 [{id, from, to, ...}]

    // === 交互状态 (UI State) ===
    const activeTrackId = ref(null) // 当前激活（左侧选中）的轨道 ID
    const timelineScrollLeft = ref(0) // 时间轴水平滚动位置 (用于同步)
    const zoomLevel = ref(1.0) // 缩放倍率 (0.2 - 3.0)

    // 拖拽相关
    const globalDragOffset = ref(0)
    const draggingSkillData = ref(null) // 存储从库里拖出来的技能信息 (Ghost Data)

    // 选中状态
    const selectedActionId = ref(null)       // 当前选中的时间轴动作块
    const selectedLibrarySkillId = ref(null) // 当前选中的左侧技能库图标

    // 数据覆盖 (Overrides)
    const characterOverrides = ref({}) // 存储对基础技能数值的修改

    // 连线模式状态
    const isLinking = ref(false)
    const linkingSourceId = ref(null)
    const linkingEffectIndex = ref(null) // 如果是从 Buff 图标发起的连线，记录索引
    const lastLinkTime = ref(0)

    // === 计算属性 (Getters) ===

    /**
     * 计算当前的单位宽度 (像素/秒)
     * 所有的渲染组件 (Grid, Chart, Item) 都应依赖此值
     */
    const timeBlockWidth = computed(() => BASE_BLOCK_WIDTH * zoomLevel.value)

    /**
     * 获取当前激活干员的技能库列表
     * 这是一个工厂函数：它会合并角色基础数据 + 用户自定义修改 (Overrides)
     */
    const activeSkillLibrary = computed(() => {
        const activeChar = characterRoster.value.find(c => c.id === activeTrackId.value)
        if (!activeChar) return []

        const getAnomalies = (list) => list || []
        const getAllowed = (list) => list || []

        // 内部辅助函数：构建标准技能对象
        const createBaseSkill = (suffix, type, name) => {
            const globalId = `${activeChar.id}_${suffix}`
            // 读取用户覆盖值
            const globalOverride = characterOverrides.value[globalId] || {}

            // 读取 JSON 原始值
            const rawDuration = activeChar[`${suffix}_duration`] || 1
            const rawCooldown = activeChar[`${suffix}_cooldown`] || 0

            // 设置不同类型的默认资源消耗/回复规则
            let defaults = { spCost: 0, spGain: 0, gaugeCost: 0, gaugeGain: 0 }

            if (suffix === 'attack') {
                defaults.spGain = activeChar.attack_spGain || 0
            } else if (suffix === 'skill') {
                defaults.spCost = activeChar.skill_spCost || 100;
                defaults.spGain = activeChar.skill_spReply || 0;
                defaults.gaugeGain = activeChar.skill_gaugeGain || 0
            } else if (suffix === 'link') {
                defaults.spGain = activeChar.link_spGain || 0;
                defaults.gaugeGain = activeChar.link_gaugeGain || 0
            } else if (suffix === 'ultimate') {
                defaults.gaugeCost = activeChar.ultimate_gaugeMax || 1000;
                defaults.spGain = activeChar.ultimate_spReply || 0;
                defaults.gaugeGain = activeChar.ultimate_gaugeReply || 0
            } else if (suffix === 'execution') {
                defaults.spGain = activeChar.execution_spGain || 0;
            }

            // 合并所有属性：覆盖值 > 默认规则值 > 原始值
            const merged = {
                duration: rawDuration,
                cooldown: rawCooldown,
                ...defaults,
                ...globalOverride
            }

            return {
                id: globalId,
                type: type,
                name: name,
                duration: merged.duration,
                cooldown: merged.cooldown,
                spCost: merged.spCost,
                spGain: merged.spGain,
                gaugeCost: merged.gaugeCost,
                gaugeGain: merged.gaugeGain,
                allowedTypes: getAllowed(activeChar[`${suffix}_allowed_types`]),
                physicalAnomaly: getAnomalies(activeChar[`${suffix}_anomalies`])
            }
        }

        return [
            createBaseSkill('attack', 'attack', '重击'),
            createBaseSkill('execution', 'execution', '处决'),
            createBaseSkill('skill', 'skill', '战技'),
            createBaseSkill('link', 'link', '连携'),
            createBaseSkill('ultimate', 'ultimate', '终结技')
        ]
    })

    /**
     * 整合轨道信息与角色详情
     * 用于 TimelineGrid 头部显示头像、名字等
     */
    const teamTracksInfo = computed(() => tracks.value.map(track => {
        const charInfo = characterRoster.value.find(c => c.id === track.id)
        return { ...track, ...(charInfo || { name: '未知', avatar: '', rarity: 0 }) }
    }))


    // === 业务逻辑 (Actions) ===

    function setZoom(val) {
        // 限制缩放范围，防止过小看不清或过大崩溃
        if (val < 0.2) val = 0.2
        if (val > 3.0) val = 3.0
        zoomLevel.value = val
    }

    function setDraggingSkill(skill) { draggingSkillData.value = skill }
    function setDragOffset(offset) { globalDragOffset.value = offset }
    function setScrollLeft(val) { timelineScrollLeft.value = val }

    /**
     * 全局 SP 模拟算法
     * 1. 收集所有消耗/回复事件。
     * 2. 按时间轴推进，结合自然回体 (+8/s) 计算每个时刻的 SP 值。
     * 3. 考虑溢出截断 (Max 300)。
     */
    function calculateGlobalSpData() {
        const events = []
        tracks.value.forEach(track => {
            if (!track.actions) return
            track.actions.forEach(action => {
                if (action.spCost > 0) events.push({ time: action.startTime, change: -action.spCost, type: 'cost' })
                if (action.spGain > 0) events.push({ time: action.startTime + action.duration, change: action.spGain, type: 'gain' })
            })
        })
        events.sort((a, b) => a.time - b.time)

        const points = [];
        let currentSp = 200; // 默认初始 SP
        let currentTime = 0;
        points.push({ time: 0, sp: currentSp });

        const advanceTime = (targetTime) => {
            const timeDiff = targetTime - currentTime; if (timeDiff <= 0) return;

            if (currentSp >= SP_MAX) {
                // 已满，保持水平直线
                currentTime = targetTime;
                points.push({ time: currentTime, sp: SP_MAX });
                return;
            }

            const potentialGain = timeDiff * SP_REGEN_RATE;
            const projectedSp = currentSp + potentialGain;

            if (projectedSp >= SP_MAX) {
                // 中途满了，先画到满的那一刻
                const timeToMax = (SP_MAX - currentSp) / SP_REGEN_RATE;
                points.push({ time: currentTime + timeToMax, sp: SP_MAX });
                currentSp = SP_MAX;
                currentTime = targetTime;
                points.push({ time: currentTime, sp: SP_MAX });
            } else {
                // 没满，正常增长
                currentSp = projectedSp;
                currentTime = targetTime;
                points.push({ time: currentTime, sp: currentSp });
            }
        }

        events.forEach(ev => {
            advanceTime(ev.time);
            currentSp += ev.change;
            if (currentSp > SP_MAX) currentSp = SP_MAX; // 瞬时回复导致溢出
            // 注意：这里不处理 currentSp < 0 的修正，因为要显示负值警告
            points.push({ time: currentTime, sp: currentSp, type: ev.type })
        });

        if (currentTime < TOTAL_DURATION) advanceTime(TOTAL_DURATION);
        return points
    }

    /**
     * 角色充能模拟算法
     * 计算特定轨道的大招充能进度 (Gauge)
     */
    function calculateGaugeData(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return []
        const charInfo = characterRoster.value.find(c => c.id === trackId)
        if (!charInfo) return []

        const libId = `${trackId}_ultimate`
        const override = characterOverrides.value[libId]
        // 优先级：轨道独立设置 > 库覆盖设置 > 默认值
        const GAUGE_MAX = (track.maxGaugeOverride && track.maxGaugeOverride > 0)
            ? track.maxGaugeOverride
            : ((override && override.gaugeCost) ? override.gaugeCost : (charInfo.ultimate_gaugeMax || 100))

        const events = []
        track.actions.forEach(action => {
            if (action.gaugeCost > 0) events.push({ time: action.startTime, change: -action.gaugeCost })
            if (action.gaugeGain > 0) events.push({ time: action.startTime + action.duration, change: action.gaugeGain })
        })

        events.sort((a, b) => a.time - b.time)

        // 读取初始充能，并截断溢出
        const initialGauge = track.initialGauge || 0
        let currentGauge = initialGauge > GAUGE_MAX ? GAUGE_MAX : initialGauge

        const points = [];
        points.push({ time: 0, val: currentGauge, ratio: currentGauge / GAUGE_MAX });

        events.forEach(ev => {
            // 阶梯状变化：变化前先记录一次当前值
            points.push({ time: ev.time, val: currentGauge, ratio: currentGauge / GAUGE_MAX })

            currentGauge += ev.change
            if (currentGauge > GAUGE_MAX) currentGauge = GAUGE_MAX
            if (currentGauge < 0) currentGauge = 0

            // 变化后记录新值
            points.push({ time: ev.time, val: currentGauge, ratio: currentGauge / GAUGE_MAX })
        })

        // 补全结尾
        points.push({ time: TOTAL_DURATION, val: currentGauge, ratio: currentGauge / GAUGE_MAX })
        return points
    }

    // === 核心 CRUD 操作 ===

    function updateTrackMaxGauge(trackId, value) {
        const track = tracks.value.find(t => t.id === trackId)
        if (track) track.maxGaugeOverride = value
    }

    function updateTrackInitialGauge(trackId, value) {
        const track = tracks.value.find(t => t.id === trackId)
        if (track) track.initialGauge = value
    }

    function updateLibrarySkill(skillId, props) {
        if (!characterOverrides.value[skillId]) characterOverrides.value[skillId] = {}
        Object.assign(characterOverrides.value[skillId], props)
        // 同步更新所有已放置的实例
        tracks.value.forEach(track => {
            if (!track.actions) return
            track.actions.forEach(action => {
                if (action.id === skillId) { Object.assign(action, props) }
            })
        })
    }

    // 技能实例克隆工厂
    const cloneSkill = (skill) => {
        const clonedAnomalies = skill.physicalAnomaly ? JSON.parse(JSON.stringify(skill.physicalAnomaly)) : [];
        return { ...skill, instanceId: `inst_${uid()}`, physicalAnomaly: clonedAnomalies }
    }

    function addSkillToTrack(trackId, skill, startTime) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return

        const newAction = cloneSkill(skill)
        newAction.startTime = startTime

        track.actions.push(newAction)
        track.actions.sort((a, b) => a.startTime - b.startTime)
    }

    function selectLibrarySkill(skillId) {
        selectedActionId.value = null
        selectedLibrarySkillId.value = (selectedLibrarySkillId.value === skillId) ? null : skillId
    }

    function selectAction(instanceId) {
        selectedLibrarySkillId.value = null
        selectedActionId.value = (instanceId === selectedActionId.value) ? null : instanceId
    }

    function updateAction(instanceId, newProperties) {
        for (const track of tracks.value) {
            const action = track.actions.find(a => a.instanceId === instanceId)
            if (action) { Object.assign(action, newProperties); return; }
        }
    }

    function removeAction(instanceId) {
        if (!instanceId) return
        for (const track of tracks.value) {
            const index = track.actions.findIndex(a => a.instanceId === instanceId)
            if (index !== -1) { track.actions.splice(index, 1); break; }
        }
        // 级联删除相关连线
        connections.value = connections.value.filter(c => c.from !== instanceId && c.to !== instanceId)
        if (selectedActionId.value === instanceId) selectedActionId.value = null
    }

    function selectTrack(trackId) {
        activeTrackId.value = trackId
        selectedActionId.value = null
        selectedLibrarySkillId.value = null
        cancelLinking()
    }

    function changeTrackOperator(trackIndex, oldOperatorId, newOperatorId) {
        const track = tracks.value[trackIndex];
        if (track) {
            if (tracks.value.some((t, i) => i !== trackIndex && t.id === newOperatorId)) {
                alert('该干员已在另一条轨道上！'); return;
            }
            track.id = newOperatorId;
            track.actions = []; // 换人清空动作
            // 如果正好是当前选中的，更新 activeTrackId
            if (activeTrackId.value === oldOperatorId) activeTrackId.value = newOperatorId;
        }
    }

    // === 数据加载与导出 ===

    async function fetchGameData() {
        try {
            isLoading.value = true
            const response = await fetch('/gamedata.json')
            if (!response.ok) throw new Error('无法加载 gamedata.json')
            const data = await response.json()
            const sortedRoster = data.characterRoster.sort((a, b) => (b.rarity || 0) - (a.rarity || 0));
            characterRoster.value = sortedRoster
            iconDatabase.value = data.ICON_DATABASE
        } catch (error) { console.error("加载游戏数据失败:", error) } finally { isLoading.value = false }
    }

    function exportProject() {
        const projectData = {
            version: '2.0.0',
            timestamp: Date.now(),
            tracks: tracks.value,
            connections: connections.value,
            characterOverrides: characterOverrides.value
        }
        const jsonString = JSON.stringify(projectData, null, 2)
        const blob = new Blob([jsonString], { type: 'application/json' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `endaxis_project_${new Date().toISOString().slice(0,10)}.json`
        link.click()
        URL.revokeObjectURL(link.href)
    }

    async function importProject(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result)
                    if (!data.tracks) throw new Error("无效的项目文件")
                    tracks.value = data.tracks
                    connections.value = data.connections || []
                    characterOverrides.value = data.characterOverrides || {}
                    selectedActionId.value = null
                    selectedLibrarySkillId.value = null
                    resolve(true)
                } catch (err) { reject(err) }
            }
            reader.readAsText(file)
        })
    }

    // === 连线逻辑 ===

    function startLinking(effectIndex = null) {
        if (!selectedActionId.value) return;

        // 如果当前已经是连线模式，且来源ID和来源Effect都一致，说明用户再次点击了同一个按钮 -> 执行取消
        if (isLinking.value && linkingSourceId.value === selectedActionId.value && linkingEffectIndex.value === effectIndex) {
            if (now - lastLinkTime.value < 500) {
                return;
            }
            cancelLinking();
            return;
        }

        // 否则，正常开启连线模式
        isLinking.value = true;
        linkingSourceId.value = selectedActionId.value;
        linkingEffectIndex.value = effectIndex;
    }

    function confirmLinking(targetId) {
        if (!isLinking.value || !linkingSourceId.value) return cancelLinking();

        // [修改] 允许自连接检测，但不弹窗，仅静默取消
        if (linkingSourceId.value === targetId) {
            cancelLinking();
            return;
        }

        // 重复连接检测
        const exists = connections.value.some(c => c.from === linkingSourceId.value && c.to === targetId && c.fromEffectIndex === linkingEffectIndex.value)
        if (!exists) {
            connections.value.push({ id: `conn_${uid()}`, from: linkingSourceId.value, to: targetId, fromEffectIndex: linkingEffectIndex.value })
        }
        cancelLinking()
    }

    function cancelLinking() {
        isLinking.value = false;
        linkingSourceId.value = null;
        linkingEffectIndex.value = null;
    }

    function removeConnection(connId) {
        connections.value = connections.value.filter(c => c.id !== connId)
    }

    return {
        // State
        isLoading, characterRoster, iconDatabase, tracks, connections,
        activeTrackId, timelineScrollLeft, zoomLevel,
        globalDragOffset, draggingSkillData,
        selectedActionId, selectedLibrarySkillId,
        isLinking, linkingSourceId, linkingEffectIndex,

        // Getters
        teamTracksInfo, activeSkillLibrary, timeBlockWidth,

        // Actions
        fetchGameData, exportProject, importProject,TOTAL_DURATION,
        selectTrack, changeTrackOperator,
        selectLibrarySkill, updateLibrarySkill,
        selectAction, updateAction, removeAction,
        cloneSkill, addSkillToTrack,
        setDraggingSkill, setDragOffset, setScrollLeft, setZoom,
        calculateGlobalSpData, calculateGaugeData,
        updateTrackInitialGauge, updateTrackMaxGauge,
        startLinking, confirmLinking, cancelLinking, removeConnection
    }
})