const JOB_BOARD_DOMAINS = new Set([
  "indeed.com", "linkedin.com", "glassdoor.com", "ziprecruiter.com",
  "monster.com", "careerbuilder.com", "dice.com", "simplyhired.com",
  "simplyhired.co.in", "jobstreet.com", "naukri.com", "jooble.com",
  "flexjobs.com", "zippia.com", "apna.co", "workingnomads.com",
  "virtualvocations.com", "totaljobs.com", "shine.com",
  "internshala.com", "salesdevjobs.com", "iimjobs.com",
  "monster.com", "careerbuilder.com", "snagajob.com",
  "builtin.com", "builtin.io", "velvetjobs.com", "erekrut.com",
  "placementindia.com", "quikr.com", "truelancer.com",
  "upwork.com", "freelancer.com", "fiverr.com", "toptal.com",
  "peopleperhour.com", "guru.com", "workable.com",
  "interviewguy.com", "salesso.com", "wellfound.com", "angel.co",
  "vietnamworks.com", "joingenius.com", "igamingrecruitment.io",
  "saganrecruitment.com",
  "jobzmall.com", "peaksalesrecruiting.com",
])

const JOB_BOARD_KEYWORDS = [
  "job board", "job portal", "job listing", "job search",
  "career portal", "career site", "hiring platform",
  "recruitment platform", "talent marketplace", "freelance platform",
  "job aggregator", "job matching", "jobsite",
]

const RECRUITING_AGENCY_DOMAINS = new Set([
  "roberthalf.com", "randstad.com", "adecco.com", "kellyservices.com",
  "manpower.com", "signalhire.com", "chatterworks.com", "leadhaste.com",
  "salesfolks.com", "exceedsales.com", "salesfocusinc.com",
  "adaface.com", "salesleopard.com",
])

const RECRUITING_AGENCY_KEYWORDS = [
  "recruitment agency", "staffing agency", "recruiting firm",
  "talent acquisition agency", "headhunter", "executive search",
  "staffing firm", "placement agency", "recruiting services",
  "sales staffing", "sales recruiting", "staffing solutions",
  "sales recruiting", "peak sales recruiting",
]

export function isJobBoardDomain(domain: string): boolean {
  const d = domain.toLowerCase().trim().replace(/^www\./, "")
  if (JOB_BOARD_DOMAINS.has(d)) return true
  if (JOB_BOARD_DOMAINS.has("www." + d)) return true
  return false
}

export function isJobBoardByName(name: string): boolean {
  const lower = name.toLowerCase()
  return JOB_BOARD_KEYWORDS.some(kw => lower.includes(kw))
}

export function isRecruitingAgencyDomain(domain: string): boolean {
  const d = domain.toLowerCase().trim().replace(/^www\./, "")
  if (RECRUITING_AGENCY_DOMAINS.has(d)) return true
  if (RECRUITING_AGENCY_DOMAINS.has("www." + d)) return true
  return false
}

export function isRecruitingAgencyByName(name: string): boolean {
  const lower = name.toLowerCase()
  return RECRUITING_AGENCY_KEYWORDS.some(kw => lower.includes(kw))
}

export function isJobBoardOrRecruiter(domain: string, name: string): boolean {
  return (
    isJobBoardDomain(domain) ||
    isJobBoardByName(name) ||
    isRecruitingAgencyDomain(domain) ||
    isRecruitingAgencyByName(name)
  )
}
