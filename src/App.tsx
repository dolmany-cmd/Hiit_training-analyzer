import { useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from 'recharts';
import { Upload, Download, Activity, Heart, Flame, TrendingUp } from 'lucide-react';

interface TrackPointData {
  time: number;
  heartRate: number;
  timestamp: Date;
}

const HIITAnalyzer = () => {
  const [tcxData, setTcxData] = useState<TrackPointData[] | null>(null);
  const [chartData, setChartData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [userParams, setUserParams] = useState({
    maxHR: 175,
    age: 51,
    weight: 86,
    warmupTime: 300, // 5 minutes in seconds
    activePhase: 120,
    recoveryPhase: 120,
    intervals: 6,
    cooldownTime: 180
  });
  const [isLoading, setIsLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const parseDate = (dateStr: string | null) => {
    // Handle different date formats in TCX
    if (!dateStr) return null;
    try {
      return new Date(dateStr);
    } catch (e) {
      return null;
    }
  };

  const parseTCX = async (file: File): Promise<TrackPointData[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          if (!e.target?.result) {
            throw new Error('Failed to read file content');
          }
          
          const result = e.target.result;
          if (typeof result !== 'string') {
            throw new Error('File content is not text');
          }
          
          const xmlText = result;
          console.log('XML text length:', xmlText.length);
          
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
          
          // Check for parsing errors
          const parserError = xmlDoc.querySelector('parsererror');
          if (parserError) {
            throw new Error('Invalid XML format: ' + parserError.textContent);
          }
          
          console.log('XML parsed successfully');
          
          // Extract trackpoints - try multiple possible selectors
          let trackpoints = xmlDoc.querySelectorAll('Trackpoint');
          if (trackpoints.length === 0) {
            trackpoints = xmlDoc.querySelectorAll('trackpoint');
          }
          if (trackpoints.length === 0) {
            trackpoints = xmlDoc.querySelectorAll('*[localName="Trackpoint" i]');
          }
          
          console.log('Found trackpoints:', trackpoints.length);
          
          if (trackpoints.length === 0) {
            throw new Error('No trackpoints found in TCX file. Please ensure this is a valid activity file.');
          }
          
          const data: TrackPointData[] = [];
          let startTime: Date | null = null;
          let validPointsCount = 0;
          
          trackpoints.forEach((point, index) => {
            // Try multiple selectors for time and heart rate
            const timeElement = point.querySelector('Time') || 
                               point.querySelector('time') || 
                               point.querySelector('*[localName="Time" i]');
                               
            const hrElement = point.querySelector('HeartRateBpm Value') || 
                             point.querySelector('HeartRateBpm value') ||
                             point.querySelector('heartratebpm value') ||
                             point.querySelector('*[localName="HeartRateBpm" i] *[localName="Value" i]') ||
                             point.querySelector('hr') ||
                             point.querySelector('HeartRate');
            
            if (timeElement && hrElement) {
              const timeText = timeElement.textContent || timeElement.getAttribute('value');
              const hrText = hrElement.textContent || hrElement.getAttribute('value');
              
              if (timeText && hrText) {
                const time = parseDate(timeText);
                const heartRate = parseInt(hrText);
              
                if (time && !isNaN(heartRate) && heartRate > 0 && heartRate < 220) {
                  if (!startTime) startTime = time;
                  const elapsedSeconds = Math.floor((time.getTime() - startTime.getTime()) / 1000);
                
                  data.push({
                    time: elapsedSeconds,
                    heartRate: heartRate,
                    timestamp: time
                  });
                  validPointsCount++;
                }
              }
            }
            
            // Debug first few points
            if (index < 5) {
              console.log(`Point ${index}:`, {
                timeElement: timeElement?.textContent,
                hrElement: hrElement?.textContent,
                parsed: data[data.length - 1]
              });
            }
          });
          
          console.log('Valid heart rate points found:', validPointsCount);
          
          if (data.length === 0) {
            throw new Error('No valid heart rate data found. Please check that your TCX file contains heart rate measurements.');
          }
          
          // Sort by time to ensure proper order
          data.sort((a, b) => a.time - b.time);
          
          resolve(data);
        } catch (error) {
          console.error('TCX parsing error:', error);
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const calculateHRZones = (maxHR: number) => {
    return {
      zone1: { min: Math.round(maxHR * 0.5), max: Math.round(maxHR * 0.6), name: 'Recovery', color: '#10B981' },
      zone2: { min: Math.round(maxHR * 0.6), max: Math.round(maxHR * 0.7), name: 'Aerobic', color: '#3B82F6' },
      zone3: { min: Math.round(maxHR * 0.7), max: Math.round(maxHR * 0.8), name: 'Aerobic Threshold', color: '#F59E0B' },
      zone4: { min: Math.round(maxHR * 0.8), max: Math.round(maxHR * 0.9), name: 'Lactate Threshold', color: '#EF4444' },
      zone5: { min: Math.round(maxHR * 0.9), max: maxHR, name: 'VO2 Max', color: '#8B5CF6' }
    };
  };

  const calculateCalories = (avgHR: number, weight: number, durationMinutes: number, age: number, gender: string = 'male') => {
    // More accurate calorie calculation using heart rate reserve method
    const maxHR = 220 - age;
    const restingHR = 60; // Assume average resting HR
    const hrReserve = maxHR - restingHR;
    const workingHR = avgHR - restingHR;
    const hrIntensity = workingHR / hrReserve;
    
    // Gender-based metabolic rate adjustment
    const genderFactor = gender === 'male' ? 1.0 : 0.9;
    
    // More conservative calorie estimation (3.5-12 METs range)
    const mets = 3.5 + (hrIntensity * 8.5); // Scale from 3.5 to 12 METs
    const caloriesPerMinute = (mets * 3.5 * weight * genderFactor) / 200;
    
    return Math.round(caloriesPerMinute * durationMinutes);
  };

  const analyzeHIIT = (data: TrackPointData[], params: any) => {
    const zones = calculateHRZones(params.maxHR);
    const totalDuration = data[data.length - 1].time;
    
    // Define HIIT phases based on user parameters
    const warmupEnd = params.warmupTime;
    const cooldownStart = totalDuration - params.cooldownTime;
    const cycleLength = params.activePhase + params.recoveryPhase;
    const hiitDuration = cooldownStart - warmupEnd;
    
    const intervals = [];
    let recoveryScores = [];
    
    // Analyze each interval
    for (let i = 0; i < params.intervals; i++) {
      const intervalStart = warmupEnd + (i * cycleLength);
      const activeEnd = intervalStart + params.activePhase;
      const recoveryEnd = intervalStart + cycleLength;
      
      if (recoveryEnd <= cooldownStart) {
        const activeData = data.filter((d: any) => d.time >= intervalStart && d.time <= activeEnd);
        const recoveryData = data.filter((d: any) => d.time > activeEnd && d.time <= recoveryEnd);
        
        if (activeData.length > 0 && recoveryData.length > 0) {
          const maxActive = Math.max(...activeData.map(d => d.heartRate));
          const minRecovery = Math.min(...recoveryData.map(d => d.heartRate));
          const recoveryScore = maxActive - minRecovery;
          
          recoveryScores.push({
            interval: i + 1,
            maxActive,
            minRecovery,
            recoveryScore
          });
          
          intervals.push({
            interval: i + 1,
            start: intervalStart,
            activeEnd,
            recoveryEnd,
            maxActive,
            minRecovery,
            recoveryScore
          });
        }
      }
    }
    
    // Calculate cumulative recovery score
    const cumulativeRecoveryScore = recoveryScores.reduce((sum, score) => sum + score.recoveryScore, 0);
    
    // Calculate zone distribution
    const zoneDistribution = Object.keys(zones).reduce((acc, zone) => {
      acc[zone] = 0;
      return acc;
    }, {});
    
    data.forEach(point => {
      const hr = point.heartRate;
      Object.keys(zones).forEach(zone => {
        if (hr >= zones[zone as keyof typeof zones].min && hr <= zones[zone as keyof typeof zones].max) {
          zoneDistribution[zone as keyof typeof zoneDistribution]++;
        }
      });
    });
    
    // Calculate average heart rate and perceived intensity
    const avgHR = Math.round(data.reduce((sum, d) => sum + d.heartRate, 0) / data.length);
    const perceivedIntensity = Math.round((avgHR / params.maxHR) * 100);
    
    // Calculate calories
    const durationMinutes = totalDuration / 60;
    const calories = calculateCalories(avgHR, params.weight, durationMinutes, params.age);
    
    return {
      zones,
      intervals,
      recoveryScores,
      cumulativeRecoveryScore,
      zoneDistribution,
      avgHR,
      perceivedIntensity,
      calories,
      totalDuration: Math.round(durationMinutes),
      warmupEnd,
      cooldownStart
    };
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log('File selected:', file.name, 'Type:', file.type, 'Size:', file.size);
    
    if (!file.name.toLowerCase().endsWith('.tcx')) {
      alert('Please select a valid TCX file (.tcx extension)');
      return;
    }

    setIsLoading(true);
    try {
      console.log('Starting TCX parsing...');
      const data = await parseTCX(file);
      console.log('TCX data parsed:', data.length, 'points');
      
      if (data.length === 0) {
        alert('No heart rate data found in the TCX file. Please check that your file contains heart rate information.');
        setIsLoading(false);
        return;
      }
      
      setTcxData(data);
      
      // Re-analyze with current parameters when file changes
      const analysisResult = analyzeHIIT(data, userParams);
      setAnalysis(analysisResult);
      
      // Create chart data with zone coloring
      const zones = calculateHRZones(userParams.maxHR);
      const chartData = data.map(point => ({
        ...point,
        timeMinutes: Math.round(point.time / 60 * 10) / 10,
        zone: Object.keys(zones).find(zone => 
          point.heartRate >= zones[zone].min && point.heartRate <= zones[zone].max
        ) || 'zone1'
      }));
      
      setChartData(chartData);
      
      console.log('Analysis complete');
      
    } catch (error) {
      console.error('TCX parsing error:', error);
      alert('Error parsing TCX file: ' + error.message + '. Please ensure the file is a valid TCX format with heart rate data.');
    }
    setIsLoading(false);
  };

  const exportAsImage = () => {
    // Since html2canvas doesn't work reliably in this environment, 
    // we'll provide the text export with a helpful message
    alert('Image export is not supported in this environment. Generating detailed text report instead.');
    exportAsText();
  };

  const exportAsText = () => {
    if (!analysis) {
      alert('No analysis data to export');
      return;
    }
    
    // Create a comprehensive text report with better formatting
    const reportText = `
╔════════════════════════════════════════════════════════════════════════════════╗
║                            HIIT TRAINING ANALYSIS REPORT                       ║
║                          Generated: ${new Date().toLocaleString()}                         ║
╚════════════════════════════════════════════════════════════════════════════════╝

📊 WORKOUT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Average Heart Rate:        ${analysis.avgHR} bpm
  • Perceived Intensity:       ${analysis.perceivedIntensity}%
  • Estimated Calories:        ${analysis.calories} kcal
  • Total Duration:            ${analysis.totalDuration} minutes
  • Cumulative Recovery Score: ${analysis.cumulativeRecoveryScore}

❤️ HEART RATE ZONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${Object.entries(analysis.zones).map(([key, zone]) => {
  const timeInZone = analysis.zoneDistribution[key] || 0;
  const percentage = Math.round((timeInZone / chartData.length) * 100);
  return `  Zone ${zone.name.padEnd(20)} ${zone.min.toString().padStart(3)}-${zone.max.toString().padEnd(3)} bpm  (${percentage.toString().padStart(2)}% of workout)`;
}).join('\n')}

🏃 TRAINING PARAMETERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Maximum Heart Rate:    ${userParams.maxHR} bpm
  • Age:                   ${userParams.age} years
  • Weight:                ${userParams.weight} kg
  • Warmup Duration:       ${Math.round(userParams.warmupTime / 60)} minutes
  • Active Phase:          ${userParams.activePhase} seconds
  • Recovery Phase:        ${userParams.recoveryPhase} seconds
  • Number of Intervals:   ${userParams.intervals}
  • Cooldown Duration:     ${Math.round(userParams.cooldownTime / 60)} minutes

📈 INTERVAL-BY-INTERVAL RECOVERY ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${analysis.recoveryScores.map(score => 
  `  Interval ${score.interval.toString().padStart(2)}: ${score.maxActive.toString().padStart(3)} bpm → ${score.minRecovery.toString().padStart(3)} bpm (Recovery Score: ${score.recoveryScore.toString().padStart(2)})`
).join('\n')}
                                                           ─────────────────────
                                                Total Score: ${analysis.cumulativeRecoveryScore.toString().padStart(3)}

💡 PERFORMANCE INSIGHTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${analysis.perceivedIntensity >= 85 ? '  🔥 High Intensity: Excellent effort! You maintained a very high intensity.' :
  analysis.perceivedIntensity >= 70 ? '  ⚡ Moderate-High Intensity: Good workout intensity for HIIT training.' :
  '  📈 Moderate Intensity: Consider pushing harder during active phases for better HIIT benefits.'}

${analysis.cumulativeRecoveryScore >= 150 ? '  💪 Excellent Recovery: Your cardiovascular fitness is showing great recovery capacity.' :
  analysis.cumulativeRecoveryScore >= 100 ? '  👍 Good Recovery: Solid recovery between intervals, keep building endurance.' :
  '  🎯 Building Recovery: Focus on improving recovery between intervals as fitness develops.'}

${(() => {
  const zone4And5Time = (analysis.zoneDistribution.zone4 || 0) + (analysis.zoneDistribution.zone5 || 0);
  const zone4And5Percentage = Math.round((zone4And5Time / chartData.length) * 100);
  return zone4And5Percentage >= 40 ? '  🚀 High-Intensity Focus: Great time spent in high-intensity zones (80%+ max HR).' :
         zone4And5Percentage >= 20 ? '  ⭐ Balanced Training: Good mix of intensity zones for overall fitness.' :
         '  📊 Endurance Focus: More time in lower zones - consider increasing intensity for HIIT benefits.';
})()}

📋 RECOMMENDATIONS FOR NEXT SESSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${analysis.recoveryScores.some(score => score.recoveryScore < 15) ? 
  '  • Consider extending recovery phases or reducing active phase intensity' : 
  '  • Recovery looks good - you could potentially increase active phase intensity'}
${analysis.avgHR < userParams.maxHR * 0.75 ? 
  '  • Try to push harder during active phases to reach higher heart rate zones' : 
  '  • Excellent intensity - maintain this effort level'}
  • Track your cumulative recovery score over time to monitor fitness improvements
  • Aim for consistent recovery scores across all intervals
  • Ensure adequate hydration and nutrition for optimal performance

═══════════════════════════════════════════════════════════════════════════════════
Generated by HIIT Training Analyzer - Advanced Heart Rate Analysis
Report saved: ${new Date().toISOString().split('T')[0]}
═══════════════════════════════════════════════════════════════════════════════════
`;

    // Multiple fallback methods for export
    const fileName = `hiit-analysis-report-${new Date().toISOString().split('T')[0]}.txt`;
    
    // Method 1: Modern download approach
    const tryDownload = () => {
      try {
        const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        
        // Cleanup
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 100);
        
        return true;
      } catch (error) {
        console.error('Download method failed:', error);
        return false;
      }
    };

    // Method 2: Clipboard fallback
    const tryClipboard = async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(reportText);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Clipboard method failed:', error);
        return false;
      }
    };

    // Method 3: Show in modal as last resort
    const showInModal = () => {
      // Create modal overlay
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
        background: rgba(0,0,0,0.8); z-index: 10000; 
        display: flex; align-items: center; justify-content: center; 
        padding: 20px;
      `;
      
      // Create modal content
      const content = document.createElement('div');
      content.style.cssText = `
        background: white; border-radius: 12px; padding: 24px; 
        max-width: 90vw; max-height: 90vh; overflow: auto; 
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      `;
      
      content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600;">HIIT Analysis Report</h3>
          <button id="closeModal" style="
            background: #dc2626; color: white; border: none; border-radius: 6px; 
            padding: 8px 12px; cursor: pointer; font-weight: 500;
          ">Close</button>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          <button id="copyText" style="
            background: #2563eb; color: white; border: none; border-radius: 6px; 
            padding: 10px 16px; cursor: pointer; font-weight: 500;
          ">Copy to Clipboard</button>
          <button id="selectAll" style="
            background: #059669; color: white; border: none; border-radius: 6px; 
            padding: 10px 16px; cursor: pointer; font-weight: 500;
          ">Select All Text</button>
        </div>
        <textarea id="reportText" readonly style="
          width: 100%; height: 400px; font-family: monospace; font-size: 12px; 
          border: 1px solid #d1d5db; border-radius: 6px; padding: 12px;
          background: #f9fafb; resize: none;
        ">${reportText}</textarea>
        <p style="margin-top: 12px; color: #6b7280; font-size: 14px;">
          💡 Select all text and copy manually, or use the buttons above
        </p>
      `;
      
      modal.appendChild(content);
      document.body.appendChild(modal);
      
      // Event listeners
      const closeModal = () => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      };
      
      modal.querySelector('#closeModal').addEventListener('click', closeModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
      
      modal.querySelector('#copyText').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(reportText);
          alert('✅ Report copied to clipboard!');
        } catch (error) {
          alert('❌ Copy failed. Please select and copy the text manually.');
        }
      });
      
      modal.querySelector('#selectAll').addEventListener('click', () => {
        const textarea = modal.querySelector('#reportText');
        textarea.select();
        textarea.setSelectionRange(0, 99999); // For mobile devices
      });
      
      // Auto-select text for easy copying
      setTimeout(() => {
        const textarea = modal.querySelector('#reportText');
        textarea.focus();
        textarea.select();
      }, 100);
    };

    // Execute export methods in order
    const executeExport = async () => {
      console.log('Attempting to export report...');
      
      // Try download first
      if (tryDownload()) {
        setTimeout(() => {
          alert('✅ Report downloaded successfully! Check your Downloads folder.');
        }, 500);
        return;
      }
      
      // Try clipboard second  
      const clipboardSuccess = await tryClipboard();
      if (clipboardSuccess) {
        alert('📋 Download failed, but report copied to clipboard! You can paste it into a text editor and save manually.');
        return;
      }
      
      // Show modal as last resort
      alert('💡 Download and clipboard failed. Opening report in a modal - you can copy the text manually.');
      setTimeout(showInModal, 100);
    };
    
    executeExport();
  };

  const getZoneColor = (heartRate) => {
    if (!analysis) return '#8884d8';
    
    const zones = analysis.zones;
    for (const [key, zone] of Object.entries(zones)) {
      if (heartRate >= zone.min && heartRate <= zone.max) {
        return zone.color;
      }
    }
    return '#8884d8';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
                <Activity className="text-blue-600" />
                HIIT Training Analyzer
              </h1>
              <p className="text-gray-600 mt-2">Advanced heart rate training analysis for HIIT workouts</p>
            </div>
            {tcxData && (
              <div className="flex gap-2">
                <button
                  onClick={exportAsText}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download size={20} />
                  Export Report
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Parameters Input */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Training Parameters</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max HR</label>
              <input
                type="number"
                value={userParams.maxHR}
                onChange={(e) => setUserParams({...userParams, maxHR: parseInt(e.target.value) || 175})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
              <input
                type="number"
                value={userParams.age}
                onChange={(e) => setUserParams({...userParams, age: parseInt(e.target.value) || 51})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
              <input
                type="number"
                value={userParams.weight}
                onChange={(e) => setUserParams({...userParams, weight: parseInt(e.target.value) || 86})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warmup (s)</label>
              <input
                type="number"
                value={userParams.warmupTime}
                onChange={(e) => setUserParams({...userParams, warmupTime: parseInt(e.target.value) || 300})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Active (s)</label>
              <input
                type="number"
                value={userParams.activePhase}
                onChange={(e) => setUserParams({...userParams, activePhase: parseInt(e.target.value) || 120})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recovery (s)</label>
              <input
                type="number"
                value={userParams.recoveryPhase}
                onChange={(e) => setUserParams({...userParams, recoveryPhase: parseInt(e.target.value) || 120})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Intervals</label>
              <input
                type="number"
                value={userParams.intervals}
                onChange={(e) => setUserParams({...userParams, intervals: parseInt(e.target.value) || 6})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cooldown (s)</label>
              <input
                type="number"
                value={userParams.cooldownTime}
                onChange={(e) => setUserParams({...userParams, cooldownTime: parseInt(e.target.value) || 180})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Upload Training Data</h2>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
            <Upload className="mx-auto text-gray-400 mb-4" size={48} />
            <div className="space-y-3">
              <label htmlFor="tcx-upload" className="cursor-pointer inline-block">
                <span className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
                  Choose TCX File
                </span>
                <input
                  id="tcx-upload"
                  type="file"
                  accept=".tcx,application/vnd.garmin.tcx+xml"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <p className="text-gray-500">or drag and drop your .TCX file here</p>
              <p className="text-sm text-gray-400">Supports files from Garmin, Polar, Suunto, and other fitness devices</p>
            </div>
            {isLoading && (
              <div className="mt-4">
                <div className="inline-flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                  <p className="text-blue-600">Processing TCX file...</p>
                </div>
              </div>
            )}
            {tcxData && !isLoading && (
              <div className="mt-4 p-3 bg-green-50 rounded-lg">
                <p className="text-green-700 font-medium">✓ File loaded successfully!</p>
                <p className="text-sm text-green-600">{tcxData.length} heart rate data points processed</p>
              </div>
            )}
          </div>
        </div>

        {/* Analysis Results */}
        {analysis && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center">
                  <Heart className="text-red-500 mr-3" size={24} />
                  <div>
                    <p className="text-sm text-gray-600">Average HR</p>
                    <p className="text-2xl font-bold text-gray-800">{analysis.avgHR} bpm</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center">
                  <TrendingUp className="text-blue-500 mr-3" size={24} />
                  <div>
                    <p className="text-sm text-gray-600">Intensity</p>
                    <p className="text-2xl font-bold text-gray-800">{analysis.perceivedIntensity}%</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center">
                  <Flame className="text-orange-500 mr-3" size={24} />
                  <div>
                    <p className="text-sm text-gray-600">Calories</p>
                    <p className="text-2xl font-bold text-gray-800">{analysis.calories}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center">
                  <Activity className="text-green-500 mr-3" size={24} />
                  <div>
                    <p className="text-sm text-gray-600">Recovery Score</p>
                    <p className="text-2xl font-bold text-gray-800">{analysis.cumulativeRecoveryScore}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Heart Rate Chart and Zone Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* Heart Rate Chart */}
              <div className="lg:col-span-2 bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Heart Rate Analysis</h2>
                <div ref={chartRef} style={{ width: '100%', height: 400 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <defs>
                        <linearGradient id="hrGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563EB" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#2563EB" stopOpacity={0.1}/>
                        </linearGradient>
                        
                        {/* Zone background gradients */}
                        {Object.entries(analysis.zones).map(([key, zone]) => (
                          <linearGradient key={`zone-${key}`} id={`zone-${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={zone.color} stopOpacity={0.1}/>
                            <stop offset="100%" stopColor={zone.color} stopOpacity={0.05}/>
                          </linearGradient>
                        ))}
                      </defs>
                      
                      <CartesianGrid strokeDasharray="2 2" stroke="#e5e7eb" opacity={0.5} />
                      
                      <XAxis 
                        dataKey="timeMinutes" 
                        axisLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                        tickLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                        label={{ 
                          value: 'Time (minutes)', 
                          position: 'insideBottom', 
                          offset: -10,
                          style: { textAnchor: 'middle', fill: '#374151', fontSize: '14px', fontWeight: '500' }
                        }}
                      />
                      
                      <YAxis 
                        axisLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                        tickLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                        label={{ 
                          value: 'Heart Rate (bpm)', 
                          angle: -90, 
                          position: 'insideLeft',
                          style: { textAnchor: 'middle', fill: '#374151', fontSize: '14px', fontWeight: '500' }
                        }}
                      />
                      
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                          fontSize: '14px'
                        }}
                        formatter={(value, name) => [
                          <span style={{ color: '#2563EB', fontWeight: '600' }}>{value} bpm</span>, 
                          'Heart Rate'
                        ]}
                        labelFormatter={(value) => `Time: ${value} min`}
                        labelStyle={{ color: '#374151', fontWeight: '500' }}
                      />
                      
                      <Legend 
                        wrapperStyle={{ paddingTop: '20px' }}
                        iconType="line"
                      />
                      
                      {/* HR Zone background areas */}
                      {Object.entries(analysis.zones).reverse().map(([key, zone]) => (
                        <ReferenceLine 
                          key={`${key}-min`}
                          y={zone.min} 
                          stroke={zone.color} 
                          strokeDasharray="4 4" 
                          strokeWidth={1.5}
                          opacity={0.6}
                        />
                      ))}
                      
                      {/* Warmup and cooldown lines */}
                      <ReferenceLine 
                        x={analysis.warmupEnd / 60} 
                        stroke="#059669" 
                        strokeDasharray="6 3" 
                        strokeWidth={2}
                        opacity={0.7}
                        label={{
                          value: "Warmup End",
                          position: "topLeft",
                          style: { fill: '#059669', fontSize: '12px', fontWeight: '500' }
                        }}
                      />
                      <ReferenceLine 
                        x={analysis.cooldownStart / 60} 
                        stroke="#dc2626" 
                        strokeDasharray="6 3" 
                        strokeWidth={2}
                        opacity={0.7}
                        label={{
                          value: "Cooldown Start",
                          position: "topRight",
                          style: { fill: '#dc2626', fontSize: '12px', fontWeight: '500' }
                        }}
                      />
                      
                      <Line 
                        type="monotone" 
                        dataKey="heartRate" 
                        stroke="#2563EB" 
                        strokeWidth={3}
                        dot={false}
                        fill="url(#hrGradient)"
                        name="Heart Rate"
                        activeDot={{ 
                          r: 6, 
                          fill: '#2563EB',
                          stroke: '#ffffff',
                          strokeWidth: 2
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Zone Legend */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-lg font-medium text-gray-800 mb-3">Heart Rate Zones</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {Object.entries(analysis.zones).map(([key, zone]) => (
                      <div key={key} className="flex items-center space-x-3 p-2 bg-white rounded-lg shadow-sm">
                        <div 
                          className="w-4 h-4 rounded-full shadow-sm" 
                          style={{ backgroundColor: zone.color }}
                        ></div>
                        <div>
                          <div className="text-sm font-medium text-gray-800">{zone.name}</div>
                          <div className="text-xs text-gray-600">{zone.min}-{zone.max}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Heart Rate Zone Distribution Pie Chart */}
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Zone Distribution</h2>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={Object.entries(analysis.zoneDistribution).map(([key, value]) => ({
                          name: analysis.zones[key].name,
                          value: Math.round((value / chartData.length) * 100),
                          count: value,
                          color: analysis.zones[key].color,
                          zone: key
                        })).filter(item => item.value > 0)}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={40}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {Object.entries(analysis.zoneDistribution).map(([key, value]) => (
                          <Cell 
                            key={`cell-${key}`} 
                            fill={analysis.zones[key].color}
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        )).filter((_, index) => Object.values(analysis.zoneDistribution)[index] > 0)}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                          fontSize: '14px'
                        }}
                        formatter={(value, name) => [
                          <span style={{ fontWeight: '600' }}>{value}%</span>, 
                          name
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Zone percentages legend */}
                <div className="mt-4 space-y-2">
                  {Object.entries(analysis.zoneDistribution)
                    .map(([key, value]) => ({
                      key,
                      value,
                      percentage: Math.round((value / chartData.length) * 100),
                      zone: analysis.zones[key]
                    }))
                    .filter(item => item.value > 0)
                    .sort((a, b) => b.percentage - a.percentage)
                    .map(item => (
                      <div key={item.key} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: item.zone.color }}
                          ></div>
                          <span className="text-sm font-medium text-gray-700">{item.zone.name}</span>
                        </div>
                        <div className="text-sm font-semibold text-gray-800">
                          {item.percentage}%
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Recovery Scores Table */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Recovery Analysis</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Interval
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Max Active HR
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Min Recovery HR
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Recovery Score
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {analysis.recoveryScores.map((score, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {score.interval}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {score.maxActive} bpm
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {score.minRecovery} bpm
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                          {score.recoveryScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td colSpan="3" className="px-6 py-4 text-sm font-medium text-gray-900">
                        Cumulative Recovery Score
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-blue-600">
                        {analysis.cumulativeRecoveryScore}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">Recovery Score Interpretation:</h4>
                <p className="text-sm text-blue-800">
                  Higher recovery scores indicate better cardiovascular fitness and recovery capacity. 
                  The cumulative score allows comparison between different workout sessions - track this over time to monitor fitness improvements.
                </p>
              </div>
            </div>

            {/* Bottom Export Button */}
            <div className="mt-8 text-center">
              <button
                onClick={exportAsText}
                className="inline-flex items-center gap-3 px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
              >
                <Download size={24} />
                Export Detailed Analysis Report
              </button>
              <p className="text-sm text-gray-600 mt-2">
                Downloads a comprehensive text report with all analysis data, insights, and recommendations
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default HIITAnalyzer;
