import { useState, useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { treaty } from '@elysiajs/eden'
import { PlusIcon, ExternalLinkIcon, CircleAlertIcon, CheckIcon, CircleIcon, GitPullRequestIcon, Trash2Icon, RefreshCwIcon, FileTextIcon } from 'lucide-react'
import type { App } from '@universal-contributor/db-api'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

const api = treaty<App>('localhost:3002')

// Types
interface Issue {
  id: number
  repository_id: number
  github_issue_number: number
  title: string
  url: string
  body: string | null
  labels: string | null
  status: string
  ai_analysis: string | null
  ai_fix_prompt: string | null
}

interface Workspace {
  id: number
  issue_id: number | null
  container_id: string | null
  status: string
  branch_name: string | null
  error_message: string | null
  dockerfile: string | null
  created_at: string
}

interface WorkspaceLog {
  id: number
  workspace_id: number
  line: string
  stream: 'stdout' | 'stderr'
  created_at: string
}

interface Agent {
  id: number
  name: string
  status: string
}

interface Contribution {
  id: number
  pr_url: string | null
  pr_number: number | null
  status: string
}

// API Functions
const fetchIssues = async (): Promise<Issue[]> => {
  const { data, error } = await api.issues.get()
  if (error) throw new Error(String(error))
  return data as Issue[]
}

const fetchIssueById = async (issueId: number): Promise<Issue> => {
  const { data, error } = await api.issues({ id: String(issueId) }).get()
  if (error) throw new Error(String(error))
  return data as Issue
}

const addIssueApi = async (issueUrl: string) => {
  // Parse GitHub issue URL: https://github.com/owner/repo/issues/123
  const match = issueUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/)
  if (!match) {
    throw new Error('Invalid GitHub issue URL')
  }

  const [, fullName, issueNumber] = match
  const repoUrl = `https://github.com/${fullName}`

  // Check if repository exists
  const { data: repos } = await api.repositories.get({ query: { full_name: fullName } })
  let repoId: number

  if (!repos || repos.length === 0) {
    // Create repository
    const { data: newRepo, error: repoError } = await api.repositories.post({
      full_name: fullName,
      url: repoUrl,
      source: 'manual',
    })
    if (repoError || !newRepo) throw new Error('Failed to create repository')
    repoId = newRepo.id
  } else {
    repoId = repos[0].id
  }

  // Check if issue already exists
  const { data: existingIssues } = await api.issues.get({
    query: {
      repository_id: String(repoId),
      github_issue_number: issueNumber,
    },
  })

  if (existingIssues && existingIssues.length > 0) {
    throw new Error('Issue already exists')
  }

  // Create new issue with 'pending' status
  const { data: newIssue, error: issueError } = await api.issues.post({
    repository_id: repoId,
    github_issue_number: parseInt(issueNumber),
    title: `Issue #${issueNumber}`,
    url: issueUrl,
    status: 'pending',
  })

  if (issueError || !newIssue) throw new Error('Failed to create issue')

  return { issueId: newIssue.id, issueUrl, fullName }
}

const extractIssueDataApi = async (issueId: number) => {
  // Trigger extraction via the db-api
  const { data, error } = await api.issues({ id: String(issueId) }).extract.post()
  if (error) throw new Error(String(error))
  return data
}

const getOrCreateAgentApi = async (): Promise<Agent> => {
  const { data: agents } = await api.agents.get()
  if (agents && agents.length > 0) {
    return agents[0] as Agent
  }
  const { data: newAgent, error } = await api.agents.post({ name: 'web-agent' })
  if (error || !newAgent) throw new Error('Failed to create agent')
  return newAgent as Agent
}

const spawnWorkspaceApi = async (issueId: number, agentId: number): Promise<Workspace> => {
  const { data, error } = await api.workspaces.spawn.post({
    issue_id: issueId,
    agent_id: agentId,
  })
  if (error) throw new Error(String(error))
  return data as Workspace
}

const getWorkspaceApi = async (workspaceId: number): Promise<Workspace> => {
  const { data, error } = await api.workspaces({ id: String(workspaceId) }).get()
  if (error) throw new Error(String(error))
  return data as Workspace
}

const getContributionsByIssueApi = async (issueId: number): Promise<Contribution[]> => {
  const { data, error } = await api.contributions.get({ query: { issue_id: String(issueId) } })
  if (error) throw new Error(String(error))
  return (data || []) as Contribution[]
}

const deleteIssueApi = async (issueId: number) => {
  const { error } = await api.issues({ id: String(issueId) }).delete()
  if (error) throw new Error(String(error))
}

const getWorkspaceLogsApi = async (workspaceId: number, afterId?: number): Promise<WorkspaceLog[]> => {
  const query = afterId ? { after_id: String(afterId) } : {}
  const { data, error } = await api.workspaces({ id: String(workspaceId) }).logs.get({ query })
  if (error) throw new Error(String(error))
  return (data || []) as WorkspaceLog[]
}

const cancelWorkspaceApi = async (workspaceId: number) => {
  const { data, error } = await api.workspaces({ id: String(workspaceId) }).destroy.post()
  if (error) throw new Error(String(error))
  return data
}

const getWorkspacesByIssueApi = async (issueId: number): Promise<Workspace[]> => {
  const { data, error } = await api.workspaces.get({ query: { issue_id: String(issueId) } })
  if (error) throw new Error(String(error))
  return (data || []) as Workspace[]
}

export const Route = createFileRoute('/issues')({
  component: IssuesPage,
})

function IssuesPage() {
  const queryClient = useQueryClient()

  // Add Issue Dialog State
  const [issueUrl, setIssueUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [extractingIds, setExtractingIds] = useState<Set<number>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)

  // Fix with AI State
  const [fixingIssue, setFixingIssue] = useState<Issue | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)
  const [fixDialogOpen, setFixDialogOpen] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const [contribution, setContribution] = useState<Contribution | null>(null)
  const [workspaceLogs, setWorkspaceLogs] = useState<WorkspaceLog[]>([])
  const [lastLogId, setLastLogId] = useState<number>(0)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  // Delete Issue State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [issueToDelete, setIssueToDelete] = useState<Issue | null>(null)

  // View Logs Dialog State
  const [logsDialogOpen, setLogsDialogOpen] = useState(false)
  const [logsDialogIssue, setLogsDialogIssue] = useState<Issue | null>(null)
  const [logsDialogWorkspaces, setLogsDialogWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null)
  const [historicalLogs, setHistoricalLogs] = useState<WorkspaceLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const historicalLogsContainerRef = useRef<HTMLDivElement>(null)

  // Fetch issues with auto-refresh for active states
  const { data: issues, isLoading } = useQuery<Issue[]>({
    queryKey: ['issues'],
    queryFn: fetchIssues,
    refetchInterval: (query: { state: { data: Issue[] | undefined } }) => {
      const data = query.state.data
      const hasActiveIssue = data?.some(
        (issue) =>
          issue.status === 'pending' ||
          issue.status === 'extracting' ||
          issue.status === 'fixing'
      )
      return hasActiveIssue || extractingIds.size > 0 ? 3000 : false
    },
  })

  // Poll workspace status while fix dialog is open
  const { data: workspaceStatus } = useQuery({
    queryKey: ['workspace', activeWorkspace?.id],
    queryFn: () => (activeWorkspace ? getWorkspaceApi(activeWorkspace.id) : null),
    enabled: !!activeWorkspace && fixDialogOpen,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Stop polling when complete or failed
      if (
        status === 'completed' ||
        status === 'destroyed' ||
        status === 'build_failed' ||
        status === 'container_crashed' ||
        status === 'timeout'
      ) {
        return false
      }
      return 2000 // Poll every 2 seconds
    },
  })

  // Poll workspace logs while fix dialog is open
  useQuery({
    queryKey: ['workspace-logs', activeWorkspace?.id, lastLogId],
    queryFn: async () => {
      if (!activeWorkspace) return []
      const newLogs = await getWorkspaceLogsApi(activeWorkspace.id, lastLogId || undefined)
      if (newLogs.length > 0) {
        setWorkspaceLogs((prev) => [...prev, ...newLogs])
        setLastLogId(newLogs[newLogs.length - 1].id)
      }
      return newLogs
    },
    enabled: !!activeWorkspace && fixDialogOpen,
    refetchInterval: () => {
      const status = activeWorkspace?.status
      // Stop polling when complete or failed
      if (
        status === 'completed' ||
        status === 'destroyed' ||
        status === 'build_failed' ||
        status === 'container_crashed' ||
        status === 'timeout'
      ) {
        // Do one final fetch then stop
        return false
      }
      return 1000 // Poll logs every 1 second
    },
  })

  // Batch poll extracting issues to check for completion
  const { data: polledIssues } = useQuery({
    queryKey: ['issues-extraction-poll', Array.from(extractingIds)],
    queryFn: async () => {
      const results = await Promise.all(
        Array.from(extractingIds).map((id) => fetchIssueById(id))
      )
      return results
    },
    enabled: extractingIds.size > 0,
    refetchInterval: 2000,
  })

  // Update cache and show toasts when extraction completes
  useEffect(() => {
    if (!polledIssues) return

    polledIssues.forEach((issue) => {
      if (issue.status === 'extracted' || issue.status === 'error') {
        // Update issues list cache with the new data
        queryClient.setQueryData(['issues'], (old: Issue[] | undefined) => {
          if (!old) return old
          return old.map((i) => (i.id === issue.id ? issue : i))
        })

        // Remove from extracting set
        setExtractingIds((prev) => {
          const next = new Set(prev)
          next.delete(issue.id)
          return next
        })

        // Show toast notification
        if (issue.status === 'extracted') {
          toast.success('Issue extracted', { description: issue.title })
        } else {
          toast.error('Extraction failed', {
            description: issue.ai_analysis || 'Unknown error',
          })
        }
      }
    })
  }, [polledIssues, queryClient])

  // Update activeWorkspace when polling returns new data
  useEffect(() => {
    if (workspaceStatus) {
      setActiveWorkspace(workspaceStatus)

      // When completed, fetch contribution for PR URL
      if (workspaceStatus.status === 'completed' && fixingIssue) {
        getContributionsByIssueApi(fixingIssue.id)
          .then((contributions) => {
            if (contributions.length > 0) {
              setContribution(contributions[0])
            }
          })
          .catch(console.error)

        // Refresh issues list
        queryClient.invalidateQueries({ queryKey: ['issues'] })
      }
    }
  }, [workspaceStatus, fixingIssue, queryClient])

  // Auto-scroll logs to bottom when new logs arrive
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [workspaceLogs])

  // Add Issue Mutation
  const addIssueMutation = useMutation({
    mutationFn: addIssueApi,
    onSuccess: async (result: { issueId: number; issueUrl: string; fullName: string }) => {
      setIssueUrl('')
      setDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['issues'] })

      // Start extraction in background (fire-and-forget)
      // Polling will handle completion detection
      setExtractingIds((prev) => new Set(prev).add(result.issueId))
      extractIssueDataApi(result.issueId).catch((e) => {
        console.error('Extraction request failed:', e)
      })
    },
    onError: (e: Error) => {
      setError(e.message)
    },
  })

  // Delete Issue Mutation
  const deleteIssueMutation = useMutation({
    mutationFn: deleteIssueApi,
    onSuccess: () => {
      setDeleteDialogOpen(false)
      setIssueToDelete(null)
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })

  // Cancel Workspace Mutation
  const cancelWorkspaceMutation = useMutation({
    mutationFn: async () => {
      if (!activeWorkspace) throw new Error('No active workspace')
      await cancelWorkspaceApi(activeWorkspace.id)
      // Reset issue status back to 'open'
      if (fixingIssue) {
        await api.issues({ id: String(fixingIssue.id) }).patch({ status: 'open' })
      }
    },
    onSuccess: () => {
      toast.success('Fix cancelled', { description: 'The workspace has been destroyed' })
      setFixDialogOpen(false)
      setActiveWorkspace(null)
      setFixingIssue(null)
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    },
    onError: (err: Error) => {
      toast.error('Failed to cancel', { description: err.message })
    },
  })

  const handleDeleteClick = (issue: Issue) => {
    setIssueToDelete(issue)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (issueToDelete) {
      deleteIssueMutation.mutate(issueToDelete.id)
    }
  }

  const handleRetryExtraction = (issueId: number) => {
    // Fire-and-forget - polling will handle completion detection
    setExtractingIds((prev) => new Set(prev).add(issueId))
    toast.info('Retrying extraction...')

    extractIssueDataApi(issueId).catch((e) => {
      console.error('Extraction request failed:', e)
    })
  }

  // View Logs Handlers
  const handleViewLogs = async (issue: Issue) => {
    setLogsDialogIssue(issue)
    setLogsDialogOpen(true)
    setLogsLoading(true)
    setHistoricalLogs([])
    setSelectedWorkspaceId(null)

    try {
      const workspaces = await getWorkspacesByIssueApi(issue.id)
      setLogsDialogWorkspaces(workspaces)

      // Auto-select the most recent workspace
      if (workspaces.length > 0) {
        setSelectedWorkspaceId(workspaces[0].id)
        const logs = await getWorkspaceLogsApi(workspaces[0].id)
        setHistoricalLogs(logs)
      }
    } catch (err) {
      console.error('Failed to load workspaces:', err)
    } finally {
      setLogsLoading(false)
    }
  }

  const handleWorkspaceChange = async (workspaceId: string) => {
    const id = parseInt(workspaceId)
    setSelectedWorkspaceId(id)
    setLogsLoading(true)

    try {
      const logs = await getWorkspaceLogsApi(id)
      setHistoricalLogs(logs)
    } catch (err) {
      console.error('Failed to load logs:', err)
    } finally {
      setLogsLoading(false)
    }
  }

  const formatWorkspaceOption = (workspace: Workspace): string => {
    const date = new Date(workspace.created_at)
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    return `#${workspace.id} - ${workspace.status} (${dateStr})`
  }

  const submitIssue = () => {
    if (!issueUrl.trim()) return
    setError(null)
    addIssueMutation.mutate(issueUrl)
  }

  // Resume Fix Dialog Handler - opens the modal for an issue already being fixed
  const handleResumeFixDialog = async (issue: Issue) => {
    setFixingIssue(issue)
    setFixDialogOpen(true)
    setFixError(null)
    setContribution(null)
    setWorkspaceLogs([])
    setLastLogId(0)

    try {
      // Fetch existing workspaces for this issue
      const workspaces = await getWorkspacesByIssueApi(issue.id)
      if (workspaces.length > 0) {
        // Get the most recent workspace (first in the list)
        const workspace = workspaces[0]
        setActiveWorkspace(workspace)

        // Fetch existing logs for this workspace
        const logs = await getWorkspaceLogsApi(workspace.id)
        if (logs.length > 0) {
          setWorkspaceLogs(logs)
          setLastLogId(logs[logs.length - 1].id)
        }

        // Check for existing contribution if completed
        if (workspace.status === 'completed') {
          const contributions = await getContributionsByIssueApi(issue.id)
          if (contributions.length > 0) {
            setContribution(contributions[0])
          }
        }
      }
    } catch (err) {
      console.error('Failed to resume fix dialog:', err)
      setFixError(err instanceof Error ? err.message : 'Failed to load workspace status')
    }
  }

  // Fix with AI Handler
  const handleFixWithAI = async (issue: Issue) => {
    setFixingIssue(issue)
    setFixDialogOpen(true)
    setActiveWorkspace(null)
    setFixError(null)
    setContribution(null)
    setWorkspaceLogs([])
    setLastLogId(0)

    try {
      // Get or create agent
      const agent = await getOrCreateAgentApi()

      // Update issue status to 'fixing'
      await api.issues({ id: String(issue.id) }).patch({ status: 'fixing' })
      queryClient.invalidateQueries({ queryKey: ['issues'] })

      // Spawn workspace
      const workspace = await spawnWorkspaceApi(issue.id, agent.id)
      setActiveWorkspace(workspace)
    } catch (err) {
      console.error('Failed to start fix:', err)
      setFixError(err instanceof Error ? err.message : 'Failed to start fix')
    }
  }

  // Helper Functions
  const getStatusBadgeVariant = (
    status: string
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'pending':
      case 'extracting':
      case 'fixing':
        return 'secondary'
      case 'open':
      case 'extracted':
        return 'default'
      case 'fixed':
        return 'outline'
      case 'error':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  const getWorkspaceStatusVariant = (
    status?: string
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'building':
      case 'running':
        return 'secondary'
      case 'completed':
        return 'default'
      case 'build_failed':
      case 'container_crashed':
      case 'timeout':
        return 'destructive'
      case 'destroyed':
      case 'cancelled':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const parseLabels = (labelsJson: string | null): string[] => {
    if (!labelsJson) return []
    try {
      return JSON.parse(labelsJson)
    } catch {
      return []
    }
  }

  const formatLogTimestamp = (createdAt: string): string => {
    const date = new Date(createdAt)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatErrorMessage = (errorJson: string | null): string => {
    if (!errorJson) return 'Unknown error'
    try {
      const error = JSON.parse(errorJson)
      let message = error.message || 'Unknown error'
      if (error.details?.logs) {
        message += '\n\nLogs:\n' + error.details.logs
      }
      return message
    } catch {
      return errorJson
    }
  }

  const getStepStatus = (step: 'building' | 'running' | 'completed'): 'done' | 'active' | 'pending' => {
    const status = activeWorkspace?.status
    const stepOrder = ['building', 'running', 'completed']
    const currentIndex = stepOrder.indexOf(status || '')
    const stepIndex = stepOrder.indexOf(step)

    if (status === 'build_failed' || status === 'container_crashed' || status === 'timeout') {
      // Show error state
      if (step === 'building' && status === 'build_failed') return 'active'
      if (step === 'running' && (status === 'container_crashed' || status === 'timeout')) return 'active'
      if (stepIndex < currentIndex) return 'done'
      return 'pending'
    }

    if (stepIndex < currentIndex) return 'done'
    if (stepIndex === currentIndex) return 'active'
    return 'pending'
  }

  const StepIcon = ({ step }: { step: 'building' | 'running' | 'completed' }) => {
    const stepStatus = getStepStatus(step)
    const status = activeWorkspace?.status
    const isError =
      (step === 'building' && status === 'build_failed') ||
      (step === 'running' && (status === 'container_crashed' || status === 'timeout'))

    if (isError) {
      return <CircleAlertIcon className="size-4 text-destructive" />
    }
    if (stepStatus === 'done') {
      return <CheckIcon className="size-4 text-green-500" />
    }
    if (stepStatus === 'active') {
      return <Spinner className="size-4" />
    }
    return <CircleIcon className="size-4 text-muted-foreground" />
  }

  const isFixButtonDisabled = (issue: Issue): boolean => {
    return (
      issue.status === 'pending' ||
      issue.status === 'extracting' ||
      !issue.ai_fix_prompt
    )
  }

  const shouldShowFixButton = (issue: Issue): boolean => {
    return issue.status !== 'fixed'
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">GitHub Issues</h1>
            <p className="text-muted-foreground text-sm">
              Track and manage GitHub issues for AI-assisted fixes
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="icon">
                <PlusIcon className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add GitHub Issue</DialogTitle>
                <DialogDescription>
                  Enter the URL of a GitHub issue to track and analyze.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input
                  type="text"
                  value={issueUrl}
                  onChange={(e) => setIssueUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !addIssueMutation.isPending) {
                      submitIssue()
                    }
                  }}
                  placeholder="https://github.com/owner/repo/issues/123"
                />
                {error && <p className="text-destructive text-sm">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={issueUrl.trim().length === 0 || addIssueMutation.isPending}
                  onClick={submitIssue}
                >
                  {addIssueMutation.isPending && <Spinner className="mr-2" />}
                  {addIssueMutation.isPending ? 'Adding...' : 'Add Issue'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Fix with AI Progress Modal */}
        <Dialog open={fixDialogOpen} onOpenChange={setFixDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Fixing Issue #{fixingIssue?.github_issue_number}</DialogTitle>
              <DialogDescription className="truncate">
                {fixingIssue?.title}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Status Badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Status:</span>
                <Badge variant={getWorkspaceStatusVariant(activeWorkspace?.status)}>
                  {(activeWorkspace?.status === 'building' ||
                    activeWorkspace?.status === 'running') && <Spinner className="mr-1 size-3" />}
                  {activeWorkspace?.status || 'initializing'}
                </Badge>
              </div>

              {/* Progress Steps */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <StepIcon step="building" />
                  <span
                    className={
                      getStepStatus('building') === 'done'
                        ? 'text-muted-foreground line-through'
                        : getStepStatus('building') === 'active'
                          ? 'font-medium'
                          : 'text-muted-foreground'
                    }
                  >
                    Building Docker container...
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <StepIcon step="running" />
                  <span
                    className={
                      getStepStatus('running') === 'done'
                        ? 'text-muted-foreground line-through'
                        : getStepStatus('running') === 'active'
                          ? 'font-medium'
                          : 'text-muted-foreground'
                    }
                  >
                    Running OpenCode to fix issue...
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <StepIcon step="completed" />
                  <span
                    className={
                      getStepStatus('completed') === 'done'
                        ? 'text-muted-foreground line-through'
                        : getStepStatus('completed') === 'active'
                          ? 'font-medium'
                          : 'text-muted-foreground'
                    }
                  >
                    Creating pull request...
                  </span>
                </div>
              </div>

              {/* Execution Logs */}
              {workspaceLogs.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Logs:</span>
                  <div
                    ref={logsContainerRef}
                    className="rounded-md bg-muted/50 p-3 max-h-60 overflow-auto font-mono text-xs"
                  >
                    {workspaceLogs.map((log) => (
                      <div
                        key={log.id}
                        className={log.stream === 'stderr' ? 'text-destructive' : 'text-foreground/80'}
                      >
                        <span className="text-muted-foreground">[{formatLogTimestamp(log.created_at)}]</span>{' '}
                        {log.line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Initial Error (before workspace created) */}
              {fixError && (
                <div className="rounded-md bg-destructive/10 p-4">
                  <p className="text-sm text-destructive font-medium">Failed to start</p>
                  <p className="text-xs mt-2 text-destructive">{fixError}</p>
                </div>
              )}

              {/* Workspace Error Display */}
              {activeWorkspace?.error_message && (
                <div className="rounded-md bg-destructive/10 p-4">
                  <p className="text-sm text-destructive font-medium">Error</p>
                  <pre className="text-xs mt-2 whitespace-pre-wrap overflow-auto max-h-40 text-destructive/80">
                    {formatErrorMessage(activeWorkspace.error_message)}
                  </pre>
                </div>
              )}

              {/* Success Message */}
              {activeWorkspace?.status === 'completed' && (
                <div className="rounded-md bg-green-500/10 p-4 space-y-2">
                  <p className="text-sm text-green-600 font-medium">Fix completed successfully!</p>
                  {activeWorkspace.branch_name && (
                    <p className="text-xs text-green-600/80">
                      Branch: <code className="bg-green-500/10 px-1 rounded">{activeWorkspace.branch_name}</code>
                    </p>
                  )}
                  {contribution?.pr_url && (
                    <a
                      href={contribution.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-green-600 hover:underline"
                    >
                      <GitPullRequestIcon className="size-4" />
                      View Pull Request #{contribution.pr_number}
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Cancelled Message */}
              {activeWorkspace?.status === 'destroyed' && (
                <div className="rounded-md bg-muted p-4">
                  <p className="text-sm text-muted-foreground font-medium">Fix was cancelled</p>
                  <p className="text-xs text-muted-foreground/80 mt-1">
                    The workspace and container have been destroyed.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              {(activeWorkspace?.status === 'building' || activeWorkspace?.status === 'running') && (
                <Button
                  variant="destructive"
                  onClick={() => cancelWorkspaceMutation.mutate()}
                  disabled={cancelWorkspaceMutation.isPending}
                >
                  {cancelWorkspaceMutation.isPending && <Spinner className="mr-2 size-4" />}
                  {cancelWorkspaceMutation.isPending ? 'Cancelling...' : 'Cancel'}
                </Button>
              )}
              {(fixError ||
                activeWorkspace?.status === 'build_failed' ||
                activeWorkspace?.status === 'container_crashed' ||
                activeWorkspace?.status === 'timeout') && (
                <Button
                  onClick={() => {
                    if (fixingIssue) {
                      // Reset state and retry
                      setActiveWorkspace(null)
                      setFixError(null)
                      setWorkspaceLogs([])
                      setLastLogId(0)
                      setContribution(null)
                      handleFixWithAI(fixingIssue)
                    }
                  }}
                >
                  <RefreshCwIcon className="mr-2 size-4" />
                  Retry
                </Button>
              )}
              <Button variant="outline" onClick={() => setFixDialogOpen(false)}>
                {activeWorkspace?.status === 'completed' ||
                activeWorkspace?.status === 'build_failed' ||
                activeWorkspace?.status === 'container_crashed' ||
                activeWorkspace?.status === 'timeout' ||
                activeWorkspace?.status === 'destroyed'
                  ? 'Close'
                  : 'Run in Background'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Issue</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete issue #{issueToDelete?.github_issue_number}? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleteIssueMutation.isPending}
              >
                {deleteIssueMutation.isPending && <Spinner className="mr-2" />}
                {deleteIssueMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Logs Dialog */}
        <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Logs for Issue #{logsDialogIssue?.github_issue_number}</DialogTitle>
              <DialogDescription className="truncate">
                {logsDialogIssue?.title}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-4 py-4 overflow-hidden flex flex-col min-h-0">
              {/* Workspace Selector */}
              {logsDialogWorkspaces.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Workspace:</span>
                  <Select
                    value={selectedWorkspaceId?.toString() || ''}
                    onValueChange={handleWorkspaceChange}
                  >
                    <SelectTrigger className="w-70">
                      <SelectValue placeholder="Select workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      {logsDialogWorkspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id.toString()}>
                          {formatWorkspaceOption(ws)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Logs Display */}
              {logsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="size-6" />
                </div>
              ) : logsDialogWorkspaces.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No workspaces found for this issue.
                </div>
              ) : historicalLogs.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No logs available for this workspace.
                </div>
              ) : (
                <div
                  ref={historicalLogsContainerRef}
                  className="flex-1 rounded-md bg-muted/50 p-3 overflow-auto font-mono text-xs min-h-0"
                >
                  {historicalLogs.map((log) => (
                    <div
                      key={log.id}
                      className={log.stream === 'stderr' ? 'text-destructive' : 'text-foreground/80'}
                    >
                      <span className="text-muted-foreground">[{formatLogTimestamp(log.created_at)}]</span>{' '}
                      {log.line}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setLogsDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Issues List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : !issues || issues.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlertIcon />
              </EmptyMedia>
              <EmptyTitle>No issues yet</EmptyTitle>
              <EmptyDescription>
                Add a GitHub issue URL to get started tracking and analyzing issues.
              </EmptyDescription>
            </EmptyHeader>
            <Button onClick={() => setDialogOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              Add Issue
            </Button>
          </Empty>
        ) : (
          <div className="space-y-4">
            {issues.map((issue: Issue) => (
              <Card key={issue.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={getStatusBadgeVariant(issue.status)}
                          className={issue.status === 'fixed' ? 'bg-green-500/10 text-green-600 border-green-500/20' : ''}
                        >
                          {(issue.status === 'pending' ||
                            issue.status === 'extracting' ||
                            issue.status === 'fixing') && <Spinner className="mr-1 size-3" />}
                          {issue.status}
                        </Badge>
                        <span className="text-muted-foreground text-sm">
                          #{issue.github_issue_number}
                        </span>
                      </div>
                      <CardTitle className="text-lg">
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline inline-flex items-center gap-1"
                        >
                          {issue.title}
                          <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                        </a>
                      </CardTitle>
                      {issue.body && (
                        <CardDescription className="line-clamp-2">{issue.body}</CardDescription>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {issue.status === 'error' && (
                        <Button
                          variant="outline"
                          onClick={() => handleRetryExtraction(issue.id)}
                          disabled={extractingIds.has(issue.id)}
                        >
                          {extractingIds.has(issue.id) ? (
                            <Spinner className="mr-2 size-4" />
                          ) : (
                            <RefreshCwIcon className="mr-2 size-4" />
                          )}
                          Retry
                        </Button>
                      )}
                      {shouldShowFixButton(issue) && (
                        <Button
                          onClick={() => issue.status === 'fixing' ? handleResumeFixDialog(issue) : handleFixWithAI(issue)}
                          disabled={isFixButtonDisabled(issue)}
                          title={
                            !issue.ai_fix_prompt
                              ? 'Waiting for issue extraction to complete'
                              : undefined
                          }
                        >
                          {issue.status === 'fixing' ? (
                            <>
                              <Spinner className="mr-2 size-4" />
                              Fixing...
                            </>
                          ) : (
                            'Fix with AI'
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleViewLogs(issue)}
                        className="text-muted-foreground hover:text-foreground"
                        title="View logs"
                      >
                        <FileTextIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(issue)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {(parseLabels(issue.labels).length > 0 ||
                  (issue.status === 'error' && issue.ai_analysis)) && (
                  <CardContent className="pt-0">
                    {parseLabels(issue.labels).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {parseLabels(issue.labels).map((label: string) => (
                          <Badge key={label} variant="outline">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {issue.status === 'error' && issue.ai_analysis && (
                      <p className="text-destructive text-sm mt-2 wrap-anywhere">Error: {issue.ai_analysis}</p>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
