import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { treaty } from '@elysiajs/eden'
import { PlusIcon, ExternalLinkIcon, CircleAlertIcon, CheckIcon, CircleIcon, GitPullRequestIcon, Trash2Icon } from 'lucide-react'
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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

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
    timeout_minutes: 60,
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

  // Delete Issue State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [issueToDelete, setIssueToDelete] = useState<Issue | null>(null)

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

  // Add Issue Mutation
  const addIssueMutation = useMutation({
    mutationFn: addIssueApi,
    onSuccess: async (result: { issueId: number; issueUrl: string; fullName: string }) => {
      setIssueUrl('')
      setDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['issues'] })

      // Start extraction in background
      setExtractingIds((prev) => new Set(prev).add(result.issueId))
      extractIssueDataApi(result.issueId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['issues'] })
        })
        .catch((e) => {
          console.error('Extraction failed:', e)
        })
        .finally(() => {
          setExtractingIds((prev) => {
            const next = new Set(prev)
            next.delete(result.issueId)
            return next
          })
          queryClient.invalidateQueries({ queryKey: ['issues'] })
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

  const handleDeleteClick = (issue: Issue) => {
    setIssueToDelete(issue)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (issueToDelete) {
      deleteIssueMutation.mutate(issueToDelete.id)
    }
  }

  const submitIssue = () => {
    if (!issueUrl.trim()) return
    setError(null)
    addIssueMutation.mutate(issueUrl)
  }

  // Fix with AI Handler
  const handleFixWithAI = async (issue: Issue) => {
    setFixingIssue(issue)
    setFixDialogOpen(true)
    setActiveWorkspace(null)
    setFixError(null)
    setContribution(null)

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
      issue.status === 'fixing' ||
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
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setFixDialogOpen(false)}>
                {activeWorkspace?.status === 'completed' ||
                activeWorkspace?.status === 'build_failed' ||
                activeWorkspace?.status === 'container_crashed' ||
                activeWorkspace?.status === 'timeout'
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
                      {shouldShowFixButton(issue) && (
                        <Button
                          onClick={() => handleFixWithAI(issue)}
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
                      <p className="text-destructive text-sm mt-2">Error: {issue.ai_analysis}</p>
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
