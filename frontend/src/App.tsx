import React, { useState, useEffect, useRef } from 'react';
import { Search, Flame, Activity, Server, Zap, Database, Loader2, AlertCircle, ArrowRight, Clock, XCircle, RefreshCw, X } from 'lucide-react';
import './index.css';

interface Suggestion {
  query: string;
  all_time_count?: number;
  decayed_score?: number;
}

interface Analytics {
  totalRequests: number;
  cacheHits: number;
  hitRate: string;
  averageLatencyMs: string;
  p95LatencyMs: string;
  dbReads: number;
  dbWritesAvoided: number;
  batchQueueSize: number;
  recentLatencies: number[];
}

interface CacheDebug {
  prefix: string;
  nodeName: string;
  isHit: boolean;
  ttl?: number;
  nodeIndex: number;
  totalNodes: number;
}

const Sparkline = ({ data }: { data: number[] }) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 10);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const maxIndex = data.indexOf(Math.max(...data));
  const avgPct = 100 - (avg / max) * 100;

  return (
    <div className="sparkline-container">
      <div className="sparkline-header">
        <span>0ms</span>
        <span>{Math.round(max)}ms</span>
      </div>
      <div className="sparkline-bars">
        <div className="sparkline-avg-line" style={{ top: `${avgPct}%` }} title={`Avg: ${avg.toFixed(1)}ms`} />
        {data.map((val, i) => {
          const heightPct = (val / max) * 100;
          const isMax = i === maxIndex && val > 0;
          return (
            <div key={i} className="sparkline-bar" style={{
              height: `${Math.max(10, heightPct)}%`,
              backgroundColor: isMax ? 'var(--warning)' : 'var(--accent-2)',
              opacity: isMax ? 1 : 0.5 + (0.5 * (i / data.length))
            }} title={`${val}ms`} />
          );
        })}
      </div>
    </div>
  );
};

const HashRing = ({ totalNodes, activeIndex }: { totalNodes: number, activeIndex: number }) => {
  if (!totalNodes) return null;
  const radius = 35;
  const center = 50;
  return (
    <div className="hash-ring-container">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="35" fill="none" stroke="var(--border)" strokeWidth="2" />
        {Array.from({ length: totalNodes }).map((_, i) => {
          const angle = (i * (360 / totalNodes) - 90) * (Math.PI / 180);
          const x = center + radius * Math.cos(angle);
          const y = center + radius * Math.sin(angle);
          const isActive = (i + 1) === activeIndex;
          
          return (
            <g key={i}>
              <circle 
                cx={x} cy={y} 
                r={isActive ? 6 : 4} 
                fill={isActive ? 'var(--accent-2)' : 'var(--bg-hover)'} 
                stroke={isActive ? '#fff' : 'none'}
                strokeWidth={isActive ? 2 : 0}
                style={{ transition: 'all 0.3s ease' }}
              />
              <text 
                x={x + (x > 50 ? 10 : -10)} 
                y={y + (y > 50 ? 10 : -10)} 
                fontSize="8" 
                fill="var(--text-lo)" 
                textAnchor={x > 50 ? "start" : "end"}
                dominantBaseline="middle"
              >
                Node {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="hash-ring-legend">
        <div className="legend-item">
          <div className="legend-dot legend-active"></div> Active node
        </div>
        <div className="legend-item">
          <div className="legend-dot legend-replica"></div> Replica
        </div>
      </div>
    </div>
  );
};

const getHitRateColor = (rateStr: string) => {
  const rate = parseFloat(rateStr);
  if (isNaN(rate)) return 'var(--accent-2)';
  if (rate > 60) return 'var(--success)';
  if (rate >= 20) return 'var(--warning)';
  return 'var(--error)';
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [algorithm, setAlgorithm] = useState<'basic' | 'decay'>('basic');
  const [trending, setTrending] = useState<Suggestion[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [debug, setDebug] = useState<CacheDebug | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchResult, setSearchResult] = useState<{ message: string, query: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New UI state
  const [isFocused, setIsFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [showAllTrending, setShowAllTrending] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const trendRes = await fetch(`${API_URL}/api/trending?algorithm=${algorithm}`);
        const trendData = await trendRes.json();
        setTrending(trendData);

        const statRes = await fetch(`${API_URL}/api/analytics`);
        const statData = await statRes.json();
        setAnalytics(statData);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
      }
    };
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 3000);
    return () => clearInterval(interval);
  }, [algorithm]);

  const fetchSuggestions = async (prefix: string) => {
    if (prefix.length < 3) {
      setSuggestions([]);
      setDebug(null);
      setError(null);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      // Fetch debug info FIRST, before the suggest API potentially populates the cache
      const dbgRes = await fetch(`${API_URL}/api/cache/debug?prefix=${prefix}&algorithm=${algorithm}`);
      if (dbgRes.ok) {
        const dbgData = await dbgRes.json();
        setDebug(dbgData);
      }

      const res = await fetch(`${API_URL}/api/suggest?q=${prefix}&algorithm=${algorithm}`);
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      setSuggestions(data);
    } catch (err) {
      console.error('Error fetching suggestions:', err);
      setError('Failed to fetch suggestions. Please check your connection.');
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setShowDropdown(true);
    setSelectedIndex(-1);
    setSearchResult(null);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 200);
  };

  const handleSearchSubmit = async (searchQuery: string) => {
    if (!searchQuery) return;
    setShowDropdown(false);
    setSuggestions([]);
    
    // Add to history
    setHistory(prev => {
      const newHistory = [searchQuery, ...prev.filter(q => q !== searchQuery)].slice(0, 10);
      return newHistory;
    });

    try {
      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await res.json();
      setSearchResult(data);
    } catch (err) {
      console.error('Search submission error:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        setQuery(suggestions[selectedIndex].query);
        handleSearchSubmit(suggestions[selectedIndex].query);
      } else {
        handleSearchSubmit(query);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setIsFocused(false);
      (document.activeElement as HTMLElement)?.blur();
    }
  };

  const handleClearInput = () => {
    setQuery('');
    setSuggestions([]);
    setDebug(null);
    setShowDropdown(false);
    document.querySelector('input')?.focus();
  };

  const handleResetDemo = () => {
    setHistory([]);
    setQuery('');
    setSuggestions([]);
    setSearchResult(null);
    setDebug(null);
    // Note: Analytics reset is superficial here, real reset needs backend endpoint
  };

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-title">
          <Search size={22} color="var(--accent)" />
          Search Typeahead
        </div>
        <button className="reset-demo-btn" onClick={handleResetDemo}>
          <RefreshCw size={14} /> Reset Demo
        </button>
      </div>

      <div className="layout">
        {/* MAIN SEARCH AREA */}
        <div className="left-panel">
          <div className="header">
            <h1>Lightning-fast search</h1>
            <p>Distributed prefix search with intelligent caching</p>
          </div>

          <div className="glass-panel">
            <div className="search-container">
              <div className={`search-input-wrapper ${isFocused ? 'focused' : ''}`}>
                <Search className="search-icon" size={20} />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Start typing (e.g. 'iphone', 'what is')..."
                  value={query}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    setIsFocused(true);
                    if (query.length >= 3) setShowDropdown(true);
                  }}
                  onBlur={() => {
                    setIsFocused(false);
                    // Slight delay to allow clicking suggestions
                    setTimeout(() => setShowDropdown(false), 200);
                  }}
                />
                {!isFocused && query.length === 0 && (
                  <span className="search-shortcut">⌘K</span>
                )}
                {query.length > 0 && (
                  <button className="search-clear-btn" onClick={handleClearInput}>
                    <X size={16} />
                  </button>
                )}
                <button className="search-submit-btn" onClick={() => handleSearchSubmit(query)}>
                  <ArrowRight size={20} />
                </button>
              </div>

              {showDropdown && (isLoading || error || suggestions.length > 0) && (
                <div className="suggestions-dropdown">
                  {isLoading && (
                    <div className="dropdown-status">
                      <Loader2 className="spinner" size={20} /> Loading suggestions...
                    </div>
                  )}
                  
                  {error && !isLoading && (
                    <div className="dropdown-status error">
                      <AlertCircle size={18} /> {error}
                    </div>
                  )}

                  {!isLoading && !error && suggestions.map((item, idx) => {
                    const matchLen = query.length;
                    const boldPart = item.query.substring(0, matchLen);
                    const restPart = item.query.substring(matchLen);
                    
                    const score = algorithm === 'basic' ? (item.all_time_count || 0) : (item.decayed_score || 0);
                    const prevScore = idx > 0 ? (algorithm === 'basic' ? suggestions[idx-1].all_time_count || 0 : suggestions[idx-1].decayed_score || 0) : score;
                    const scoreDrop = prevScore - score;
                    
                    return (
                      <React.Fragment key={item.query}>
                        {idx > 0 && scoreDrop > 50 && (
                          <div className="score-divider">— less relevant —</div>
                        )}
                        <div
                          className={`suggestion-item ${idx === selectedIndex ? 'active' : ''}`}
                          onMouseDown={() => {
                            setQuery(item.query);
                            handleSearchSubmit(item.query);
                          }}
                        >
                          <span className="suggestion-text">
                            <span className="highlight">{boldPart}</span>{restPart}
                          </span>
                          <span className="suggestion-count">
                            {algorithm === 'basic' 
                              ? new Intl.NumberFormat('en-US', { notation: "compact" }).format(score) 
                              : score.toFixed(1)}
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>

            {searchResult && (
              <div className="dummy-result">
                <strong>{searchResult.message}!</strong><br />
                Submitted query: "{searchResult.query}"
              </div>
            )}

            {/* SEARCH HISTORY */}
            {history.length > 0 && (
              <div className="panel-section" style={{ marginTop: '2rem' }}>
                <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={18} color="var(--text-lo)" /> Search History
                  </span>
                  <button 
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-lo)' }}
                    onClick={() => setHistory([])}
                    title="Clear History"
                  >
                    <XCircle size={18} />
                  </button>
                </div>
                <div className="history-row">
                  {history.map(h => (
                    <div key={h} className="history-chip" onClick={() => { setQuery(h); handleSearchSubmit(h); }}>
                      <Clock size={12} /> {h}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TRENDING */}
            <div className="panel-section" style={{ marginTop: history.length > 0 ? '1.5rem' : '3rem' }}>
              <div className="panel-title">
                <Flame size={18} color="var(--error)" /> Trending Searches
              </div>
              <div className="trending-grid">
                {(showAllTrending ? trending : trending.slice(0, 6)).map((t, idx) => (
                  <div key={t.query} className="trending-card" onClick={() => { setQuery(t.query); handleSearchSubmit(t.query); }}>
                    <span className="trending-rank">#{idx + 1}</span>
                    <span className="trending-text" title={t.query}>{t.query}</span>
                  </div>
                ))}
              </div>
              {trending.length > 6 && (
                <button className="show-more-btn" onClick={() => setShowAllTrending(!showAllTrending)}>
                  {showAllTrending ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SIDEBAR DASHBOARD */}
        <div className="right-panel">
          <div className="glass-panel">
            <div className="panel-title">Ranking Algorithm</div>
            <div className="toggle-container">
              <button 
                className={`toggle-btn ${algorithm === 'basic' ? 'active' : ''}`}
                onClick={() => setAlgorithm('basic')}
              >
                All-Time Count
              </button>
              <button 
                className={`toggle-btn ${algorithm === 'decay' ? 'active' : ''}`}
                onClick={() => setAlgorithm('decay')}
              >
                Recency-Aware
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-lo)', marginTop: '0.75rem' }}>
              {algorithm === 'basic' 
                ? 'Sorts suggestions by absolute historical search frequency.' 
                : 'Applies exponential decay to prioritize recently trending searches.'}
            </p>
          </div>

          <div className="glass-panel">
            <div className="panel-title"><Server size={18} color="var(--accent)" /> Cache Debugger</div>
            <div className="debug-info">
              {debug ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <strong>Prefix:</strong> <span>"{debug.prefix}"</span>
                    <span className={debug.isHit ? 'badge-hit' : 'badge-miss'}>
                      {debug.isHit ? 'HIT' : 'MISS'}
                    </span>
                  </div>
                  <div><strong>Routed Node:</strong> {debug.nodeName}</div>
                  {debug.ttl !== undefined && <div><strong>TTL Remaining:</strong> {debug.ttl}s</div>}
                  
                  <HashRing totalNodes={debug.totalNodes} activeIndex={debug.nodeIndex} />
                </>
              ) : (
                <div style={{ color: 'var(--text-lo)' }}>Type 3+ chars to see routing info</div>
              )}
            </div>
          </div>

          <div className="glass-panel">
            <div className="panel-title">
              <Activity size={18} color="var(--accent-2)" /> 
              Analytics
              <div className="pulse-dot"></div>
            </div>
            
            <div className="analytics-list">
              <div className="analytics-item">
                <div className="analytics-label"><Activity size={14}/> Cache Hit Rate</div>
                <div className="analytics-value" style={{ color: getHitRateColor(analytics?.hitRate || '0%') }}>
                  {analytics?.hitRate || '0%'}
                </div>
              </div>
              <div className="analytics-item">
                <div className="analytics-label"><Zap size={14}/> Avg Latency</div>
                <div className="analytics-value">{analytics?.averageLatencyMs || '0'}ms</div>
              </div>
              <div className="analytics-item">
                <div className="analytics-label"><Zap size={14}/> P95 Latency</div>
                <div className="analytics-value" style={{ color: parseFloat(analytics?.p95LatencyMs || '0') > 10 ? 'var(--warning)' : 'inherit' }}>
                  {analytics?.p95LatencyMs || '0'}ms
                </div>
              </div>
              <div className="analytics-item">
                <div className="analytics-label"><Database size={14}/> DB Reads</div>
                <div className="analytics-value">{analytics?.dbReads || 0}</div>
              </div>
              <div className="analytics-item">
                <div className="analytics-label"><Loader2 size={14}/> Batch Queue</div>
                <div className="analytics-value">{analytics?.batchQueueSize || 0}</div>
              </div>
              <div className="analytics-item">
                <div className="analytics-label"><Database size={14}/> Writes Avoided</div>
                <div className="analytics-value">{analytics?.dbWritesAvoided || 0}</div>
              </div>
            </div>

            <Sparkline data={analytics?.recentLatencies || []} />
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
