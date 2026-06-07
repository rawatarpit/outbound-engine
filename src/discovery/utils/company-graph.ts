import fs from "fs"
import path from "path"

const GRAPH_FILE = path.resolve(process.cwd(), "data", "company-graph.json")

interface CompanyNode {
  companyName: string
  domain: string
  signals: string[]
  adapters: string[]
  firstSeen: number
  lastSeen: number
  leadCount: number
}

interface CompanyEdge {
  source: string
  target: string
  sharedSignals: string[]
  strength: number
  createdAt: number
}

interface CompanyGraph {
  nodes: Record<string, CompanyNode>
  edges: CompanyEdge[]
}

function load(): CompanyGraph {
  try {
    if (fs.existsSync(GRAPH_FILE)) {
      return JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"))
    }
  } catch { /* ignore */ }
  return { nodes: {}, edges: [] }
}

function save(graph: CompanyGraph): void {
  const dir = path.dirname(GRAPH_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2))
}

export function addCompany(params: {
  companyName: string
  domain: string
  signal: string
  adapter: string
}): void {
  const graph = load()
  const key = params.domain || params.companyName.toLowerCase()

  if (graph.nodes[key]) {
    const node = graph.nodes[key]
    if (!node.signals.includes(params.signal)) node.signals.push(params.signal)
    if (!node.adapters.includes(params.adapter)) node.adapters.push(params.adapter)
    node.lastSeen = Date.now()
    node.leadCount++
  } else {
    graph.nodes[key] = {
      companyName: params.companyName,
      domain: params.domain,
      signals: [params.signal],
      adapters: [params.adapter],
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      leadCount: 1,
    }
  }

  save(graph)
}

export function linkCompanies(sourceDomain: string, targetDomain: string, sharedSignals: string[]): void {
  const graph = load()
  const existing = graph.edges.find(
    e => (e.source === sourceDomain && e.target === targetDomain) ||
         (e.source === targetDomain && e.target === sourceDomain)
  )
  if (existing) {
    for (const s of sharedSignals) {
      if (!existing.sharedSignals.includes(s)) existing.sharedSignals.push(s)
    }
    existing.strength = existing.sharedSignals.length
    return
  }
  graph.edges.push({
    source: sourceDomain,
    target: targetDomain,
    sharedSignals,
    strength: sharedSignals.length,
    createdAt: Date.now(),
  })
  save(graph)
}

export function findRelatedCompanies(domain: string, minStrength = 1): { company: CompanyNode; strength: number }[] {
  const graph = load()
  const related: { company: CompanyNode; strength: number }[] = []

  for (const edge of graph.edges) {
    if (edge.strength < minStrength) continue
    if (edge.source === domain && graph.nodes[edge.target]) {
      related.push({ company: graph.nodes[edge.target], strength: edge.strength })
    } else if (edge.target === domain && graph.nodes[edge.source]) {
      related.push({ company: graph.nodes[edge.source], strength: edge.strength })
    }
  }

  return related.sort((a, b) => b.strength - a.strength)
}

export function getCompanyProfile(domain: string): CompanyNode | null {
  const graph = load()
  return graph.nodes[domain] || null
}

export function getGraphStats(): { nodeCount: number; edgeCount: number; topSignals: string[] } {
  const graph = load()
  const signalCounts: Record<string, number> = {}
  for (const node of Object.values(graph.nodes)) {
    for (const s of node.signals) {
      signalCounts[s] = (signalCounts[s] || 0) + 1
    }
  }
  const topSignals = Object.entries(signalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s)
  return { nodeCount: Object.keys(graph.nodes).length, edgeCount: graph.edges.length, topSignals }
}
