import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { treaty } from '@elysiajs/eden'
import { PlusIcon, ExternalLinkIcon, CircleAlertIcon } from 'lucide-react'
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
}

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

export const Route = createFileRoute('/issues')({
  component: IssuesPage,
})

function IssuesPage() {
  const queryClient = useQueryClient()

  const [issueUrl, setIssueUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [extractingIds, setExtractingIds] = useState<Set<number>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: issues, isLoading } = useQuery<Issue[]>({
    queryKey: ['issues'],
    queryFn: fetchIssues,
    refetchInterval: (query: { state: { data: Issue[] | undefined } }) => {
      const data = query.state.data
      const hasExtracting = data?.some(
        (issue) => issue.status === 'pending' || issue.status === 'extracting'
      )
      return hasExtracting || extractingIds.size > 0 ? 3000 : false
    },
  })

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

  const submitIssue = () => {
    if (!issueUrl.trim()) return
    setError(null)
    addIssueMutation.mutate(issueUrl)
  }

  const handleFixWithAI = (issueId: number) => {
    // Placeholder - does nothing for now
    console.log('Fix with AI clicked for issue:', issueId)
  }

  const getStatusBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'pending':
      case 'extracting':
        return 'secondary'
      case 'open':
        return 'default'
      case 'error':
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
                {error && (
                  <p className="text-destructive text-sm">{error}</p>
                )}
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

        {/* Issues List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : (!issues || issues.length === 0) ? (
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
                        <Badge variant={getStatusBadgeVariant(issue.status)}>
                          {(issue.status === 'pending' || issue.status === 'extracting') && (
                            <Spinner className="mr-1 size-3" />
                          )}
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
                        <CardDescription className="line-clamp-2">
                          {issue.body}
                        </CardDescription>
                      )}
                    </div>
                    <Button
                      onClick={() => handleFixWithAI(issue.id)}
                      disabled={issue.status === 'pending' || issue.status === 'extracting'}
                    >
                      Fix with AI
                    </Button>
                  </div>
                </CardHeader>
                {(parseLabels(issue.labels).length > 0 || (issue.status === 'error' && issue.ai_analysis)) && (
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
                      <p className="text-destructive text-sm mt-2">
                        Error: {issue.ai_analysis}
                      </p>
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
