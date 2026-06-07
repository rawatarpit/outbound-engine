import sys, json
from ddgs import DDGS

def ddg_web_search(query: str, max_results: int = 10) -> list[dict]:
    results = []
    for r in DDGS().text(query, max_results=max_results):
        results.append({
            'title': r.get('title', ''),
            'url': r.get('href', ''),
            'body': r.get('body', ''),
        })
    return results

def ddg_news_search(query: str, max_results: int = 10) -> list[dict]:
    results = []
    for r in DDGS().news(query, max_results=max_results):
        results.append({
            'title': r.get('title', ''),
            'url': r.get('url', ''),
            'body': r.get('body', ''),
        })
    return results

def ddg_jobs_search(query: str, max_results: int = 10) -> list[dict]:
    results = []
    for r in DDGS().text(query + " hiring jobs careers", max_results=max_results):
        results.append({
            'company': r.get('title', ''),
            'url': r.get('href', ''),
        })
    return results

if __name__ == '__main__':
    args = json.loads(sys.argv[1])
    query = args.get('query', '')
    source = args.get('source', 'google')
    max_results = args.get('max_results', 10)

    try:
        if source == 'news':
            results = ddg_news_search(query, max_results)
        elif source == 'jobs':
            results = ddg_jobs_search(query, max_results)
        else:
            results = ddg_web_search(query, max_results)

        print(json.dumps({
            'success': True,
            'results': results,
            'source': f'ddg_{source}',
            'query': query,
        }))
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e),
            'source': source,
            'query': query,
        }))
