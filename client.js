window.__ModuleLoader__.load({
  id: 'dsh-synapse',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const currentSession = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const id = snapshot.current
      if (id === undefined) return null
      const session = snapshot.byId[id]
      return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null }
    }
    const sessionSnapshot = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      return snapshot.ids.map(id => {
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, blank: session.blank }
      }).filter(Boolean)
    }
    const workspaceSnapshot = ctx => {
      const sessions = ctx.sessions.list.getSnapshot()
      const snapshot = ctx.workspaces.list.getSnapshot()
      const accounted = new Set(snapshot.items.flatMap(workspace => workspace.sessionIds))
      return [
        ...snapshot.items.map(workspace => ({ id: workspace.workspaceId, title: workspace.title, path: workspace.path, sessionIds: workspace.sessionIds })),
        { id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: sessions.ids.filter(id => !accounted.has(id)) },
      ]
    }

    module.exports.inject = ['sessions', 'workspaces', 'slots']
    module.exports.apply = ctx => {
      const style = document.createElement('style')
      style.textContent = '.dsh-synapse-view{display:block;width:100%;height:100%;min-height:0;border:0;background:#f5f7fa}'
      document.head.append(style)
      const disposers = []
      const SynapseTab = () => {
        const frameRef = React.useRef(null)
        const liveUnsubscribers = React.useRef(new Map())
        const knownSessionIds = React.useRef(new Set())
        const syncQueued = React.useRef(false)
        const sessionSwitchPending = React.useRef(false)
        const send = React.useCallback((type, payload = {}) => {
          const frame = frameRef.current
          if (frame?.contentWindow) frame.contentWindow.postMessage({ source: 'dsh-synapse', type, ...payload }, location.origin)
        }, [])
        const closeToChat = React.useCallback(() => {
          try {
            for (const bar of document.querySelectorAll('[role="tablist"]')) {
              const selected = bar.querySelector('[role="tab"][aria-selected="true"]')
              if (selected === null) continue
              const first = bar.querySelector('[role="tab"]')
              if (first !== null && first !== selected) first.click()
              return
            }
          } catch { /* view switch is best-effort */ }
        }, [])
        const syncLiveSessions = React.useCallback(() => {
          const frame = frameRef.current
          if (!frame) return
          const snapshot = ctx.sessions.list.getSnapshot()
          for (const id of snapshot.ids) {
            if (liveUnsubscribers.current.has(id)) continue
            const sessionScope = ctx.sessions.scope(id)
            const session = sessionScope === undefined ? undefined : ctx.sessions.sessionOf(sessionScope)
            if (session === undefined) continue
            const publish = () => {
              if (!frame.isConnected) return
              const state = session.getSnapshot()
              const text = state.partial?.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n') ?? ''
              send('synapse:live-reply', { sessionId: id, running: state.running, text })
            }
            liveUnsubscribers.current.set(id, session.subscribe(publish))
            publish()
          }
          for (const [id, unsubscribe] of liveUnsubscribers.current) {
            if (!snapshot.ids.includes(id)) { unsubscribe(); liveUnsubscribers.current.delete(id) }
          }
        }, [ctx, send])
        const syncSessions = React.useCallback(() => {
          if (syncQueued.current) return
          syncQueued.current = true
          queueMicrotask(() => {
            syncQueued.current = false
            const sessions = sessionSnapshot(ctx)
            const sessionIds = new Set(sessions.map(session => session.id))
            const removedSessionIds = [...knownSessionIds.current].filter(id => !sessionIds.has(id))
            knownSessionIds.current = sessionIds
            void fetch('/synapse/api/sessions/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessions, removedSessionIds }) }).catch(() => {})
          })
        }, [ctx])
        const syncCurrentSession = React.useCallback(() => {
          syncSessions()
          syncLiveSessions()
          send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx) })
          send('synapse:current-session', { session: currentSession(ctx) })
        }, [ctx, send, syncSessions, syncLiveSessions])
        const onMessage = React.useCallback(event => {
          if (event.origin !== location.origin || event.data?.source !== 'dsh-synapse') return
          const type = event.data.type
          if (type === 'synapse:map-ready' || type === 'synapse:map-opened') return
          if (type === 'synapse:request-current') {
            send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx) })
            send('synapse:current-session', { session: currentSession(ctx) })
            return
          }
          if (type === 'synapse:close') {
            closeToChat()
            return
          }
          if (type === 'synapse:open-session') {
            try {
              sessionSwitchPending.current = true
              ctx.sessions.open(event.data.sessionId)
            } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }) }
            return
          }
          if (type === 'synapse:activate-session') {
            try {
              sessionSwitchPending.current = true
              ctx.sessions.open(event.data.sessionId)
            } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }) }
            return
          }
          if (type === 'synapse:fork-session') {
            const atSeq = Number.isInteger(event.data.atSeq) ? event.data.atSeq : undefined
            ctx.sessions.fork({ sessionId: event.data.sessionId, atSeq, increaseTitle: true }).then(id => {
              const snapshot = ctx.sessions.list.getSnapshot()
              send('synapse:forked-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? 'DSH 分支' } })
            }).catch(() => { send('synapse:bridge-error', { message: 'DSH 分支创建失败，请确认源会话已经完成当前轮次' }) })
            return
          }
          if (type === 'synapse:send-message') {
            const text = typeof event.data.text === 'string' ? event.data.text.trim() : ''
            if (text === '') return send('synapse:bridge-error', { requestId: event.data.requestId, message: '消息不能为空' })
            const sessionScope = ctx.sessions.scope(event.data.sessionId)
            const session = sessionScope === undefined ? undefined : ctx.sessions.sessionOf(sessionScope)
            if (session === undefined) return send('synapse:bridge-error', { requestId: event.data.requestId, message: '关联的 DSH 会话已不可用' })
            session.prompt([{ type: 'text', text }], 'queue').then(result => {
              if (!result.ok) throw new Error(result.error?.message ?? 'DSH 未接受这条消息')
              send('synapse:message-sent', { requestId: event.data.requestId, sessionId: event.data.sessionId })
            }).catch(error => {
              send('synapse:bridge-error', { requestId: event.data.requestId, message: error instanceof Error ? error.message : 'DSH 消息发送失败' })
            })
            return
          }
          if (type === 'synapse:create-session') {
            const workspaceId = typeof event.data.workspaceId === 'string' && event.data.workspaceId !== '' && event.data.workspaceId !== 'dsh-ungrouped' ? event.data.workspaceId : undefined
            const cwd = typeof event.data.cwd === 'string' && event.data.cwd !== '' ? event.data.cwd : undefined
            const create = workspaceId === undefined ? ctx.sessions.create(cwd === undefined ? {} : { cwd }) : ctx.sessions.create({ workspaceId })
            create.then(id => {
              const snapshot = ctx.sessions.list.getSnapshot()
              send('synapse:created-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? '新会话', cwd: snapshot.byId[id]?.cwd ?? cwd ?? null } })
            }).catch(() => { send('synapse:bridge-error', { requestId: event.data.requestId, message: 'DSH 会话创建失败，请先在 DSH 选择工作目录' }) })
          }
        }, [ctx, send, closeToChat])
        React.useEffect(() => {
          const frame = frameRef.current
          const onFrameLoad = () => {
            try {
              const iframeDoc = frame?.contentDocument
              if (iframeDoc) {
                const s = iframeDoc.createElement('style')
                s.textContent = '.view-toggle{display:none!important}'
                iframeDoc.head.appendChild(s)
              }
            } catch { /* cross-origin or unavailable */ }
            syncCurrentSession()
            send('synapse:map-opened')
          }
          frame?.addEventListener('load', onFrameLoad)
          window.addEventListener('message', onMessage)
          const unsubscribeSessions = ctx.sessions.list.subscribe(syncCurrentSession)
          const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncCurrentSession)
          syncCurrentSession()
          send('synapse:map-opened')
          const restoreSynapseTab = () => {
            if (!sessionSwitchPending.current) return
            sessionSwitchPending.current = false
            for (const bar of document.querySelectorAll('[role="tablist"]')) {
              for (const tab of bar.querySelectorAll('[role="tab"]')) {
                if (tab.textContent.includes('\u4F1A\u8BDD\u5730\u56FE') && tab.getAttribute('aria-selected') !== 'true') {
                  tab.click()
                  return
                }
              }
            }
          }
          const observer = new MutationObserver(restoreSynapseTab)
          observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
          return () => {
            observer.disconnect()
            frame?.removeEventListener('load', onFrameLoad)
            window.removeEventListener('message', onMessage)
            unsubscribeSessions()
            unsubscribeWorkspaces()
            for (const unsubscribe of liveUnsubscribers.current.values()) unsubscribe()
            liveUnsubscribers.current.clear()
          }
        }, [ctx, syncCurrentSession, send, onMessage])
        return React.createElement('iframe', { ref: frameRef, title: '会话地图', src: '/synapse/', className: 'dsh-synapse-view' })
      }
      if (ctx.slots) {
        disposers.push(ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'synapse',
          order: 15,
          label: () => '会话地图'
        }, SynapseTab)))
      } else {
        console.warn('[dsh-synapse] slots service not found; the 会话地图 tab is unavailable')
      }
      ctx.effect(() => () => {
        for (const dispose of disposers.splice(0)) dispose()
        style.remove()
      }, 'synapse: conversation view tab ui')
    }
    return module.exports
  },
})
