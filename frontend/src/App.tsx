import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Flame, Activity, Server, Zap, Database } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
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
  dbWritesAvoided: number;
}

interface CacheDebug {
  prefix: string;
  nodeName: string;
  isHit: boolean;
}

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

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Fetch Trending & Analytics
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
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/suggest?q=${prefix}&algorithm=${algorithm}`);
      const data = await res.json();
      setSuggestions(data);

      const dbgRes = await fetch(`${API_URL}/api/cache/debug?prefix=${prefix}`);
      const dbgData = await dbgRes.json();
      setDebug(dbgData);
    } catch (err) {
      console.error('Error fetching suggestions:', err);
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
    }, 200); // 200ms debounce
  };

  const handleSearchSubmit = async (searchQuery: string) => {
    if (!searchQuery) return;
    setShowDropdown(false);
    setSuggestions([]);
    
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
    }
  };

  return (
    <div className="container">
      {/* MAIN SEARCH AREA */}
      <div className="main-content">
        <div className="header">
          <h1>Search Typeahead</h1>
          <p>Lightning-fast distributed prefix search</p>
        </div>

        <div className="glass-panel">
          <div className="search-container">
            <div className="search-input-wrapper">
              <Search className="search-icon" size={20} />
              <input
                type="text"
                className="search-input"
                placeholder="Start typing (e.g. 'iphone', 'what is')..."
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => query.length >= 3 && setShowDropdown(true)}
              />
            </div>

            {showDropdown && suggestions.length > 0 && (
              <div className="suggestions-dropdown">
                {suggestions.map((item, idx) => {
                  // Bold the matching prefix
                  const matchLen = query.length;
                  const boldPart = item.query.substring(0, matchLen);
                  const restPart = item.query.substring(matchLen);
                  
                  return (
                    <div
                      key={item.query}
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
                          ? new Intl.NumberFormat('en-US', { notation: "compact" }).format(item.all_time_count || 0) 
                          : (item.decayed_score || 0).toFixed(1)}
                      </span>
                    </div>
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

          <div className="panel-section" style={{ marginTop: '3rem' }}>
            <div className="panel-title">
              <Flame size={18} color="#ef4444" /> Trending Searches
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {trending.map(t => (
                <div key={t.query} style={{ background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.9rem', cursor: 'pointer' }}
                  onClick={() => { setQuery(t.query); handleSearchSubmit(t.query); }}
                >
                  {t.query}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SIDEBAR DASHBOARD */}
      <div className="sidebar">
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
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {algorithm === 'basic' 
              ? 'Sorts suggestions by absolute historical search frequency.' 
              : 'Applies exponential decay to prioritize recently trending searches.'}
          </p>
        </div>

        <div className="glass-panel">
          <div className="panel-title"><Server size={18} color="#a855f7" /> Cache Debugger</div>
          <div className="debug-info">
            {debug ? (
              <>
                <div><strong>Prefix:</strong> "{debug.prefix}"</div>
                <div><strong>Routed Node:</strong> {debug.nodeName}</div>
              </>
            ) : (
              <div style={{ color: 'var(--text-secondary)' }}>Type 3+ chars to see routing info</div>
            )}
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-title"><Activity size={18} color="#38bdf8" /> Analytics</div>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-value">{analytics?.hitRate || '0%'}</div>
              <div className="metric-label">Cache Hit Rate</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{analytics?.averageLatencyMs || '0'}ms</div>
              <div className="metric-label">Avg Latency</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{analytics?.totalRequests || 0}</div>
              <div className="metric-label">Total Requests</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{analytics?.dbWritesAvoided || 0}</div>
              <div className="metric-label">Writes Avoided</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
