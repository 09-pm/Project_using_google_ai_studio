/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Trophy, Play, RotateCcw, Fuel, Shield, CloudRain, Sun, FastForward } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const ROAD_WIDTH = 440;
const ROAD_LEFT = (CANVAS_WIDTH - ROAD_WIDTH) / 2;
const ROAD_RIGHT = ROAD_LEFT + ROAD_WIDTH;
const LANE_WIDTH = ROAD_WIDTH / 4;

const CAR_WIDTH = 42;
const CAR_HEIGHT = 85;
const BUS_WIDTH = 50;
const BUS_HEIGHT = 160;

const INITIAL_SPEED = 6;
const SPEED_INCREMENT = 0.1;
const WEATHER_CYCLE_DURATION = 10000; // 10 seconds

type GameState = 'START' | 'PLAYING' | 'GAME_OVER';
type Weather = 'CLEAR' | 'RAIN';

type GameObject = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'CAR' | 'BUS' | 'CAB' | 'BIKE' | 'CHECKPOINT' | 'SHIELD';
  color: string;
  speed: number;
  lane: number;
  oncoming: boolean;
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [hasShield, setHasShield] = useState(false);
  const [weather, setWeather] = useState<Weather>('CLEAR');
  const [nitroActive, setNitroActive] = useState(false);

  // Game refs
  const playerRef = useRef({
    x: ROAD_LEFT + LANE_WIDTH * 2.5 - CAR_WIDTH / 2,
    y: CANVAS_HEIGHT - 120,
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
    targetX: ROAD_LEFT + LANE_WIDTH * 2.5 - CAR_WIDTH / 2,
  });

  const objectsRef = useRef<GameObject[]>([]);
  const sceneryRef = useRef<{x: number, y: number, type: 'TREE' | 'BUILDING', height: number, width: number, color: string}[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysPressed = useRef<Record<string, boolean>>({});
  const frameCount = useRef(0);
  const gameSpeed = useRef(INITIAL_SPEED);
  const roadOffset = useRef(0);
  const lastWeatherChange = useRef(Date.now());
  const nextObjectId = useRef(0);

  // Audio Context (Lazy Init)
  const audioCtx = useRef<AudioContext | null>(null);
  const engineOsc = useRef<OscillatorNode | null>(null);
  const engineGain = useRef<GainNode | null>(null);

  const initAudio = () => {
    if (audioCtx.current) return;
    audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    engineOsc.current = audioCtx.current.createOscillator();
    engineGain.current = audioCtx.current.createGain();
    
    engineOsc.current.type = 'sawtooth';
    engineOsc.current.frequency.setValueAtTime(50, audioCtx.current.currentTime);
    engineGain.current.gain.setValueAtTime(0.05, audioCtx.current.currentTime);
    
    engineOsc.current.connect(engineGain.current);
    engineGain.current.connect(audioCtx.current.destination);
    engineOsc.current.start();
  };

  const playCrashSound = () => {
    if (!audioCtx.current) return;
    const osc = audioCtx.current.createOscillator();
    const g = audioCtx.current.createGain();
    const noise = audioCtx.current.createBufferSource();
    
    // Simple noise-like crash
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, audioCtx.current.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.current.currentTime + 0.5);
    
    g.gain.setValueAtTime(0.3, audioCtx.current.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.5);
    
    osc.connect(g);
    g.connect(audioCtx.current.destination);
    osc.start();
    osc.stop(audioCtx.current.currentTime + 0.5);
  };

  const playNitroSound = (active: boolean) => {
    if (!audioCtx.current || !active) return;
    const osc = audioCtx.current.createOscillator();
    const g = audioCtx.current.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, audioCtx.current.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.current.currentTime + 0.1);
    g.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.2);
    osc.connect(g);
    g.connect(audioCtx.current.destination);
    osc.start();
    osc.stop(audioCtx.current.currentTime + 0.2);
  };

  const playSound = (freq: number, type: OscillatorType = 'sine', duration = 0.1, volume = 0.1) => {
    if (!audioCtx.current) return;
    const osc = audioCtx.current.createOscillator();
    const g = audioCtx.current.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime);
    g.gain.setValueAtTime(volume, audioCtx.current.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + duration);
    osc.connect(g);
    g.connect(audioCtx.current.destination);
    osc.start();
    osc.stop(audioCtx.current.currentTime + duration);
  };

  const resetGame = useCallback(() => {
    playerRef.current = {
      x: ROAD_LEFT + LANE_WIDTH * 2.5 - CAR_WIDTH / 2,
      y: CANVAS_HEIGHT - 120,
      width: CAR_WIDTH,
      height: CAR_HEIGHT,
      targetX: ROAD_LEFT + LANE_WIDTH * 2.5 - CAR_WIDTH / 2,
    };
    objectsRef.current = [];
    sceneryRef.current = [];
    particlesRef.current = [];
    setScore(0);
    setHasShield(false);
    setWeather('CLEAR');
    gameSpeed.current = INITIAL_SPEED;
    roadOffset.current = 0;
    frameCount.current = 0;
    lastWeatherChange.current = Date.now();
  }, []);

  const startGame = () => {
    initAudio();
    resetGame();
    setGameState('PLAYING');
    if (audioCtx.current?.state === 'suspended') {
      audioCtx.current.resume();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.code] = true;
      if (e.code === 'Space' && (gameState === 'START' || gameState === 'GAME_OVER')) {
        startGame();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.code] = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'PLAYING') {
      if (engineGain.current) engineGain.current.gain.setTargetAtTime(0, audioCtx.current?.currentTime || 0, 0.1);
      return;
    }
    if (engineGain.current) engineGain.current.gain.setTargetAtTime(0.05, audioCtx.current?.currentTime || 0, 0.1);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const drawF1Car = (x: number, y: number, width: number, height: number, color: string, isPlayer: boolean, angle = 0) => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate(angle);
      
      // Perspective shadow
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowOffsetX = 5;
      ctx.shadowOffsetY = 5;

      // Main Chassis with gradient
      const chassisGrad = ctx.createLinearGradient(-width/2, 0, width/2, 0);
      chassisGrad.addColorStop(0, color);
      chassisGrad.addColorStop(0.5, '#fff4');
      chassisGrad.addColorStop(1, color);
      ctx.fillStyle = chassisGrad;
      
      // Tapered nose
      ctx.beginPath();
      ctx.moveTo(-width * 0.15, -height * 0.5);
      ctx.lineTo(width * 0.15, -height * 0.5);
      ctx.lineTo(width * 0.4, height * 0.1);
      ctx.lineTo(width * 0.4, height * 0.45);
      ctx.lineTo(-width * 0.4, height * 0.45);
      ctx.lineTo(-width * 0.4, height * 0.1);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Sidepods
      ctx.fillStyle = color;
      ctx.fillRect(-width * 0.55, height * 0.05, width * 0.25, height * 0.35);
      ctx.fillRect(width * 0.3, height * 0.05, width * 0.25, height * 0.35);

      // Carbon Fiber details
      ctx.fillStyle = '#111';
      ctx.fillRect(-width * 0.65, -height * 0.5, width * 1.3, height * 0.08); // Front wing
      ctx.fillRect(-width * 0.6, height * 0.4, width * 1.2, height * 0.12); // Rear wing

      // Realistic Wheels
      const drawWheel = (wx: number, wy: number, ww: number, wh: number) => {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx, wy, ww, wh);
        // Rim
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(wx + ww/2, wy + wh/2, ww/3, 0, Math.PI * 2);
        ctx.fill();
      };

      const wheelW = width * 0.28;
      const wheelH = height * 0.22;
      drawWheel(-width * 0.75, -height * 0.45, wheelW, wheelH);
      drawWheel(width * 0.47, -height * 0.45, wheelW, wheelH);
      drawWheel(-width * 0.8, height * 0.15, wheelW * 1.1, wheelH * 1.2);
      drawWheel(width * 0.47, height * 0.15, wheelW * 1.1, wheelH * 1.2);

      // Cockpit Glass
      const glassGrad = ctx.createLinearGradient(0, -height * 0.2, 0, height * 0.1);
      glassGrad.addColorStop(0, '#1e293b');
      glassGrad.addColorStop(1, '#0f172a');
      ctx.fillStyle = glassGrad;
      ctx.beginPath();
      ctx.ellipse(0, -height * 0.05, width * 0.22, height * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();

      // Helmet
      ctx.fillStyle = isPlayer ? '#fbbf24' : '#f8fafc';
      ctx.beginPath();
      ctx.arc(0, -height * 0.05, width * 0.14, 0, Math.PI * 2);
      ctx.fill();
      // Visor
      ctx.fillStyle = '#000';
      ctx.fillRect(-width * 0.1, -height * 0.1, width * 0.2, height * 0.04);

      // Headlights
      if (!isPlayer) {
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#fff';
        ctx.beginPath();
        ctx.arc(-width * 0.2, -height * 0.48, 5, 0, Math.PI * 2);
        ctx.arc(width * 0.2, -height * 0.48, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Volumetric Light
        const beamGrad = ctx.createLinearGradient(0, -height * 0.48, 0, -height * 0.48 - 150);
        beamGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
        beamGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(-width * 0.3, -height * 0.48);
        ctx.lineTo(-width * 0.6, -height * 0.48 - 150);
        ctx.lineTo(width * 0.6, -height * 0.48 - 150);
        ctx.lineTo(width * 0.3, -height * 0.48);
        ctx.fill();
      }

      ctx.restore();
    };

    const drawBike = (x: number, y: number, width: number, height: number, color: string, oncoming: boolean) => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      if (oncoming) ctx.rotate(Math.PI);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-width/2 + 2, -height/2 + 2, width, height);

      // Body
      ctx.fillStyle = color;
      ctx.fillRect(-width/2, -height/2 + 10, width, height - 20);
      
      // Wheels
      ctx.fillStyle = '#111';
      ctx.fillRect(-width/2 + 2, -height/2, width - 4, 15);
      ctx.fillRect(-width/2 + 2, height/2 - 15, width - 4, 15);

      // Rider
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(0, 0, width/2, 0, Math.PI * 2);
      ctx.fill();
      
      // Headlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(0, -height/2 + 5, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const drawBus = (x: number, y: number, width: number, height: number) => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      
      // Shadow
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowOffsetX = 8;
      ctx.shadowOffsetY = 8;

      // Body (London Red) with gradient
      const bodyGrad = ctx.createLinearGradient(-width/2, 0, width/2, 0);
      bodyGrad.addColorStop(0, '#991b1b');
      bodyGrad.addColorStop(0.5, '#ef4444');
      bodyGrad.addColorStop(1, '#991b1b');
      ctx.fillStyle = bodyGrad;
      ctx.fillRect(-width/2, -height/2, width, height);
      
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Roof details
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-width/2 + 4, -height/2 + 8, width - 8, height - 16);

      // Windows with reflection
      for(let i = 0; i < 6; i++) {
        const winY = -height/2 + 15 + i * 24;
        const winGrad = ctx.createLinearGradient(-width/2 + 8, winY, width/2 - 8, winY + 18);
        winGrad.addColorStop(0, '#1e293b');
        winGrad.addColorStop(0.5, '#334155');
        winGrad.addColorStop(1, '#1e293b');
        ctx.fillStyle = winGrad;
        ctx.fillRect(-width/2 + 8, winY, width - 16, 18);
        // Reflection
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(-width/2 + 10, winY + 2, width - 20, 4);
      }

      ctx.restore();
    };

    const drawCab = (x: number, y: number, width: number, height: number) => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-width/2 + 3, -height/2 + 3, width, height);

      ctx.fillStyle = '#111';
      ctx.fillRect(-width/2, -height/2, width, height);
      
      // Yellow taxi sign
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-10, -height/2 + 5, 20, 4);

      ctx.restore();
    };

    const update = () => {
      frameCount.current++;
      const now = Date.now();

      // Weather Cycle
      if (now - lastWeatherChange.current > WEATHER_CYCLE_DURATION) {
        setWeather(prev => prev === 'CLEAR' ? 'RAIN' : 'CLEAR');
        lastWeatherChange.current = now;
      }

      // Nitro & Speed
      const isNitro = keysPressed.current['ShiftLeft'];
      if (isNitro && !nitroActive) playNitroSound(true);
      setNitroActive(isNitro);
      const currentSpeed = isNitro ? gameSpeed.current * 1.8 : gameSpeed.current;
      
      if (isNitro) {
        // Nitro particles
        particlesRef.current.push({
          x: playerRef.current.x + playerRef.current.width / 2,
          y: playerRef.current.y + playerRef.current.height,
          vx: (Math.random() - 0.5) * 2,
          vy: 5 + Math.random() * 5,
          life: 1,
          color: '#3b82f6'
        });
      }

      // Audio Pitch
      if (engineOsc.current && audioCtx.current) {
        const pitch = 50 + (currentSpeed * 10) + (isNitro ? 50 : 0);
        engineOsc.current.frequency.setTargetAtTime(pitch, audioCtx.current.currentTime, 0.1);
      }

      // Player Movement
      const moveSpeed = 8;
      if (keysPressed.current['ArrowLeft'] && playerRef.current.x > ROAD_LEFT + 10) {
        playerRef.current.x -= moveSpeed;
      }
      if (keysPressed.current['ArrowRight'] && playerRef.current.x < ROAD_RIGHT - playerRef.current.width - 10) {
        playerRef.current.x += moveSpeed;
      }

      // Spawn Objects
      const trafficCount = objectsRef.current.filter(o => ['CAR', 'BUS', 'CAB', 'BIKE'].includes(o.type)).length;
      if (trafficCount < 3 && frameCount.current % Math.max(15, Math.floor(40 - gameSpeed.current)) === 0) {
        const lane = Math.floor(Math.random() * 4);
        const oncoming = lane < 2;
        const typeRoll = Math.random();
        let type: GameObject['type'] = 'CAR';
        let color = oncoming ? '#475569' : '#3b82f6';
        let h = CAR_HEIGHT;
        let w = CAR_WIDTH;

        if (typeRoll < 0.15) {
          type = 'BUS';
          h = BUS_HEIGHT;
          w = BUS_WIDTH;
        } else if (typeRoll < 0.3) {
          type = 'CAB';
        } else if (typeRoll < 0.5) {
          type = 'BIKE';
          w = 20;
          h = 50;
          color = ['#ef4444', '#22c55e', '#a855f7', '#f97316'][Math.floor(Math.random() * 4)];
        } else if (typeRoll < 0.55 && score > 0 && score % 20 === 0) {
          type = 'CHECKPOINT';
          w = ROAD_WIDTH;
          h = 20;
          color = '#ffffff';
        } else if (typeRoll < 0.6) {
          type = 'SHIELD';
          color = '#22d3ee';
        }

        const xPos = type === 'CHECKPOINT' ? ROAD_LEFT : ROAD_LEFT + lane * LANE_WIDTH + (LANE_WIDTH - w) / 2;

        objectsRef.current.push({
          id: nextObjectId.current++,
          x: xPos,
          y: -h - 100,
          width: w,
          height: h,
          type,
          color,
          speed: oncoming ? gameSpeed.current * 1.5 : gameSpeed.current * 0.5,
          lane,
          oncoming
        });
      }

      // Spawn Scenery
      if (frameCount.current % 20 === 0) {
        const side = Math.random() > 0.5 ? 1 : -1;
        const type = Math.random() > 0.3 ? 'TREE' : 'BUILDING';
        const x = side === 1 ? ROAD_RIGHT + 50 + Math.random() * 100 : ROAD_LEFT - 150 - Math.random() * 100;
        sceneryRef.current.push({
          x,
          y: -200,
          type,
          width: type === 'TREE' ? 40 : 80,
          height: type === 'TREE' ? 40 : 120,
          color: type === 'TREE' ? '#15803d' : '#52525b'
        });
      }

      // Update Scenery
      for (let i = sceneryRef.current.length - 1; i >= 0; i--) {
        const s = sceneryRef.current[i];
        s.y += currentSpeed;
        if (s.y > CANVAS_HEIGHT + 200) sceneryRef.current.splice(i, 1);
      }

      // Update Objects
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const obj = objectsRef.current[i];
        // STABLE MOVEMENT: Only update Y based on speed. No X drift.
        obj.y += obj.speed + (isNitro ? gameSpeed.current * 0.8 : 0);

        // Collision
        const p = playerRef.current;
        if (
          p.x < obj.x + obj.width &&
          p.x + p.width > obj.x &&
          p.y < obj.y + obj.height &&
          p.y + p.height > obj.y
        ) {
          if (obj.type === 'SHIELD') {
            setHasShield(true);
            playSound(1000, 'sine', 0.1);
            objectsRef.current.splice(i, 1);
          } else if (obj.type === 'CHECKPOINT') {
            setScore(s => s + 10);
            playSound(1200, 'sine', 0.3);
            objectsRef.current.splice(i, 1);
          } else {
            if (hasShield) {
              setHasShield(false);
              playSound(200, 'square', 0.2);
              objectsRef.current.splice(i, 1);
            } else {
              playCrashSound();
              setGameState('GAME_OVER');
              return;
            }
          }
        }

        if (obj.y > CANVAS_HEIGHT + 200) {
          objectsRef.current.splice(i, 1);
          if (obj.type === 'CAR' || obj.type === 'BUS' || obj.type === 'CAB' || obj.type === 'BIKE') {
            setScore(s => {
              const newScore = s + (isNitro ? 2 : 1);
              gameSpeed.current = INITIAL_SPEED + (newScore * SPEED_INCREMENT);
              return newScore;
            });
          }
        }
      }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        if (p.life <= 0) particlesRef.current.splice(i, 1);
      }

      roadOffset.current = (roadOffset.current + currentSpeed) % 100;
    };

    const draw = () => {
      // Background (City Stone)
      ctx.fillStyle = '#27272a';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Scenery (Trees & Buildings)
      sceneryRef.current.forEach(s => {
        ctx.save();
        if (s.type === 'TREE') {
          // Realistic Tree
          const trunkGrad = ctx.createLinearGradient(s.x + s.width/2 - 5, s.y, s.x + s.width/2 + 5, s.y);
          trunkGrad.addColorStop(0, '#451a03');
          trunkGrad.addColorStop(1, '#78350f');
          ctx.fillStyle = trunkGrad;
          ctx.fillRect(s.x + s.width/2 - 6, s.y + s.height - 15, 12, 20);
          
          const leafGrad = ctx.createRadialGradient(s.x + s.width/2, s.y + s.height/2, 5, s.x + s.width/2, s.y + s.height/2, s.width/2);
          leafGrad.addColorStop(0, '#22c55e');
          leafGrad.addColorStop(1, '#14532d');
          ctx.fillStyle = leafGrad;
          ctx.beginPath();
          ctx.arc(s.x + s.width/2, s.y + s.height/2, s.width/2, 0, Math.PI * 2);
          ctx.fill();
          // Texture
          ctx.fillStyle = 'rgba(0,0,0,0.1)';
          for(let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(s.x + Math.random()*s.width, s.y + Math.random()*s.height, 5, 0, Math.PI*2);
            ctx.fill();
          }
        } else {
          // Realistic Building
          ctx.shadowBlur = 15;
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          const bGrad = ctx.createLinearGradient(s.x, s.y, s.x + s.width, s.y);
          bGrad.addColorStop(0, '#3f3f46');
          bGrad.addColorStop(0.5, '#71717a');
          bGrad.addColorStop(1, '#3f3f46');
          ctx.fillStyle = bGrad;
          ctx.fillRect(s.x, s.y, s.width, s.height);
          
          ctx.shadowBlur = 0;
          // Windows with glow
          for(let i = 0; i < 3; i++) {
            for(let j = 0; j < 5; j++) {
              const wx = s.x + 10 + i * 22;
              const wy = s.y + 10 + j * 22;
              const isLit = Math.random() > 0.3;
              ctx.fillStyle = isLit ? '#fef08a' : '#18181b';
              if (isLit) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#fef08a';
              }
              ctx.fillRect(wx, wy, 12, 12);
              ctx.shadowBlur = 0;
            }
          }
          // Roof ledge
          ctx.fillStyle = '#18181b';
          ctx.fillRect(s.x - 5, s.y, s.width + 10, 8);
        }
        ctx.restore();
      });

      // Scenery (London Landmarks)
      const sceneryY = (roadOffset.current * 2) % CANVAS_HEIGHT;
      
      // Big Ben
      ctx.fillStyle = '#d4d4d8';
      ctx.fillRect(50, sceneryY - 200, 60, 300);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(80, sceneryY - 150, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.stroke();

      // London Eye
      ctx.strokeStyle = '#71717a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(700, ((sceneryY + 300) % CANVAS_HEIGHT) - 100, 80, 0, Math.PI * 2);
      ctx.stroke();

      // Road
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, CANVAS_HEIGHT);

      // Road Edges (Double Yellow)
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(ROAD_LEFT - 10, 0, 4, CANVAS_HEIGHT);
      ctx.fillRect(ROAD_LEFT - 4, 0, 4, CANVAS_HEIGHT);
      ctx.fillRect(ROAD_RIGHT + 2, 0, 4, CANVAS_HEIGHT);
      ctx.fillRect(ROAD_RIGHT + 8, 0, 4, CANVAS_HEIGHT);

      // Lane Markings
      ctx.setLineDash([40, 40]);
      ctx.lineDashOffset = -roadOffset.current;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      
      // Lane 1-2 divider
      ctx.beginPath(); ctx.moveTo(ROAD_LEFT + LANE_WIDTH, 0); ctx.lineTo(ROAD_LEFT + LANE_WIDTH, CANVAS_HEIGHT); ctx.stroke();
      // Lane 3-4 divider
      ctx.beginPath(); ctx.moveTo(ROAD_LEFT + LANE_WIDTH * 3, 0); ctx.lineTo(ROAD_LEFT + LANE_WIDTH * 3, CANVAS_HEIGHT); ctx.stroke();

      // Center Divider (Double White)
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(CANVAS_WIDTH / 2 - 4, 0); ctx.lineTo(CANVAS_WIDTH / 2 - 4, CANVAS_HEIGHT); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CANVAS_WIDTH / 2 + 4, 0); ctx.lineTo(CANVAS_WIDTH / 2 + 4, CANVAS_HEIGHT); ctx.stroke();

      // Rain Effect
      if (weather === 'RAIN') {
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.4)';
        ctx.lineWidth = 1;
        for(let i = 0; i < 50; i++) {
          const rx = (Math.sin(i * 123) * 0.5 + 0.5) * CANVAS_WIDTH;
          const ry = ((frameCount.current * 15 + i * 45) % CANVAS_HEIGHT);
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 5, ry + 15);
          ctx.stroke();
        }
      }

      // Particles
      particlesRef.current.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Objects
      objectsRef.current.forEach(obj => {
        if (obj.type === 'CAR') drawF1Car(obj.x, obj.y, obj.width, obj.height, obj.color, false, obj.oncoming ? Math.PI : 0);
        else if (obj.type === 'BUS') drawBus(obj.x, obj.y, obj.width, obj.height);
        else if (obj.type === 'CAB') drawCab(obj.x, obj.y, obj.width, obj.height);
        else if (obj.type === 'BIKE') drawBike(obj.x, obj.y, obj.width, obj.height, obj.color, obj.oncoming);
        else if (obj.type === 'CHECKPOINT') {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('CHECKPOINT', obj.x + obj.width/2, obj.y + 15);
          ctx.textAlign = 'start';
        } else if (obj.type === 'FUEL') {
          ctx.fillStyle = obj.color;
          ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
          ctx.fillStyle = '#000';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText('FUEL', obj.x + 5, obj.y + 25);
        } else if (obj.type === 'SHIELD') {
          ctx.strokeStyle = obj.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(obj.x + obj.width/2, obj.y + obj.height/2, 20, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Player
      if (hasShield) {
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(playerRef.current.x + playerRef.current.width/2, playerRef.current.y + playerRef.current.height/2, 60, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawF1Car(playerRef.current.x, playerRef.current.y, playerRef.current.width, playerRef.current.height, '#ef4444', true);

      // Headlights
      ctx.save();
      const grad = ctx.createRadialGradient(
        playerRef.current.x + playerRef.current.width/2, playerRef.current.y, 10,
        playerRef.current.x + playerRef.current.width/2, playerRef.current.y - 200, 300
      );
      grad.addColorStop(0, 'rgba(255,255,255,0.2)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(playerRef.current.x, playerRef.current.y);
      ctx.lineTo(playerRef.current.x - 100, playerRef.current.y - 300);
      ctx.lineTo(playerRef.current.x + playerRef.current.width + 100, playerRef.current.y - 300);
      ctx.lineTo(playerRef.current.x + playerRef.current.width, playerRef.current.y);
      ctx.fill();
      ctx.restore();
    };

    const loop = () => {
      update();
      draw();
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameState, hasShield, weather]);

  useEffect(() => {
    if (score > highScore) setHighScore(score);
  }, [score, highScore]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-sans overflow-hidden">
      <div className="relative rounded-3xl overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10 bg-zinc-900">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
        />

        {/* HUD */}
        <AnimatePresence>
          {gameState === 'PLAYING' && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute inset-0 pointer-events-none p-8 flex flex-col justify-between"
            >
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-white/50 text-xs font-bold tracking-widest uppercase">
                    <Trophy size={14} className="text-yellow-500" />
                    Grand Prix Score
                  </div>
                  <div className="text-5xl font-black text-white italic tracking-tighter">
                    {score}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-4">
                  <div className="flex items-center gap-3 bg-black/60 backdrop-blur-xl px-6 py-3 rounded-xl border-l-4 border-blue-500 skew-x-[-12deg]">
                    {weather === 'RAIN' ? <CloudRain size={20} className="text-blue-400" /> : <Sun size={20} className="text-yellow-400" />}
                    <span className="text-white text-sm font-black uppercase tracking-widest italic">{weather}</span>
                  </div>
                  
                  <div className="w-56 bg-black/60 backdrop-blur-xl p-5 rounded-2xl border border-white/10 flex flex-col gap-4 skew-x-[-6deg]">
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-[11px] font-black text-white/70 uppercase tracking-[0.2em] italic">
                        <div className="flex items-center gap-2"><FastForward size={12} className="text-blue-500" /> Nitro</div>
                        <span className={nitroActive ? 'text-blue-400' : ''}>{nitroActive ? 'MAX BOOST' : 'READY'}</span>
                      </div>
                      <div className="h-2 w-full bg-white/10 rounded-sm overflow-hidden">
                        <motion.div 
                          className="h-full bg-gradient-to-r from-blue-600 to-blue-400 shadow-[0_0_15px_#3b82f6]"
                          animate={{ width: nitroActive ? '100%' : '0%' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {hasShield && (
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="self-center mb-12 bg-cyan-500/20 backdrop-blur-md border border-cyan-500/50 px-6 py-2 rounded-full flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-widest"
                >
                  <Shield size={14} /> Shield Active
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Menus */}
        <AnimatePresence>
          {gameState !== 'PLAYING' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-950/95 backdrop-blur-3xl flex flex-col items-center justify-center text-center p-12"
            >
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-red-500 rounded-full blur-[120px]" />
              </div>

              <motion.div
                initial={{ y: 40, opacity: 0, skewX: -10 }}
                animate={{ y: 0, opacity: 1, skewX: -10 }}
                className="mb-12 relative"
              >
                <div className="inline-block px-6 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-[11px] font-black uppercase tracking-[0.4em] rounded-sm mb-6 shadow-[0_0_20px_rgba(59,130,246,0.5)]">
                  Asphalt Edition
                </div>
                <h1 className="text-9xl font-black text-white tracking-tighter italic uppercase leading-none drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)]">
                  NITRO <span className="text-transparent bg-clip-text bg-gradient-to-b from-red-500 to-orange-600">FORCE</span>
                </h1>
                <p className="text-zinc-400 mt-6 max-w-md mx-auto text-sm font-bold uppercase tracking-widest italic">
                  High-Octane Street Racing. No Limits.
                </p>
              </motion.div>

              {gameState === 'GAME_OVER' && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mb-12 grid grid-cols-2 gap-10 bg-black/60 p-10 rounded-3xl border border-white/10 skew-x-[-6deg] backdrop-blur-md"
                >
                  <div className="flex flex-col">
                    <div className="text-zinc-500 text-[11px] font-black uppercase tracking-[0.3em] mb-2 italic">Final Score</div>
                    <div className="text-6xl font-black text-white italic tracking-tighter">{score}</div>
                  </div>
                  <div className="flex flex-col border-l border-white/10 pl-10">
                    <div className="text-zinc-500 text-[11px] font-black uppercase tracking-[0.3em] mb-2 italic">Best Record</div>
                    <div className="text-6xl font-black text-blue-500 italic tracking-tighter">{highScore}</div>
                  </div>
                </motion.div>
              )}

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col items-center gap-10"
              >
                <button
                  onClick={startGame}
                  className="group relative flex items-center gap-6 px-16 py-8 bg-gradient-to-r from-white to-zinc-200 text-black font-black rounded-xl hover:from-red-600 hover:to-orange-500 hover:text-white transition-all duration-500 active:scale-95 shadow-[0_20px_60px_rgba(255,255,255,0.1)] skew-x-[-12deg] overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  {gameState === 'START' ? (
                    <>
                      <Play size={28} fill="currentColor" className="skew-x-[12deg]" />
                      <span className="text-2xl tracking-tighter skew-x-[12deg]">START RACE</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw size={28} className="skew-x-[12deg]" />
                      <span className="text-2xl tracking-tighter skew-x-[12deg]">RETRY MISSION</span>
                    </>
                  )}
                </button>
                
                <div className="flex gap-16 text-zinc-500 text-[11px] font-black tracking-[0.3em] uppercase italic">
                  <div className="flex flex-col gap-3 items-center">
                    <div className="flex gap-2">
                      <span className="w-10 h-10 flex items-center justify-center bg-zinc-900 rounded-lg border border-white/10 text-white shadow-lg">←</span>
                      <span className="w-10 h-10 flex items-center justify-center bg-zinc-900 rounded-lg border border-white/10 text-white shadow-lg">→</span>
                    </div>
                    STEERING
                  </div>
                  <div className="flex flex-col gap-3 items-center">
                    <span className="h-10 px-4 flex items-center justify-center bg-zinc-900 rounded-lg border border-white/10 text-white shadow-lg">SHIFT</span>
                    NITRO
                  </div>
                  <div className="flex flex-col gap-3 items-center">
                    <span className="h-10 px-4 flex items-center justify-center bg-zinc-900 rounded-lg border border-white/10 text-white shadow-lg">SPACE</span>
                    LAUNCH
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
