import { Suspense, useRef, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/app-store'

function ModelScene({ filePath }: { filePath: string }) {
  const [model, setModel] = useState<THREE.Object3D | null>(null)
  const [info, setInfo] = useState({ vertices: 0, faces: 0 })

  useEffect(() => {
    let cancelled = false

    async function loadModel() {
      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
      let loader: { load: (url: string, onLoad: (result: unknown) => void) => void }

      if (ext === '.fbx') {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
        loader = new FBXLoader()
      } else if (ext === '.obj') {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
        loader = new OBJLoader()
      } else {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const gltfLoader = new GLTFLoader()
        loader = {
          load: (url: string, onLoad: (result: unknown) => void) => {
            gltfLoader.load(url, (gltf) => onLoad(gltf.scene))
          }
        }
      }

      const fileUrl = `file://${filePath.replace(/\\/g, '/')}`
      loader.load(fileUrl, (result) => {
        if (cancelled) return
        const obj = result as THREE.Object3D

        // Center and scale
        const box = new THREE.Box3().setFromObject(obj)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 3 / maxDim : 1
        obj.position.sub(center)
        obj.scale.setScalar(scale)

        // Count geometry
        let verts = 0
        let faces = 0
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            const geo = mesh.geometry
            verts += geo.attributes.position?.count ?? 0
            faces += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3
          }
        })

        setModel(obj)
        setInfo({ vertices: verts, faces: Math.round(faces) })
      })
    }

    loadModel()
    return () => { cancelled = true }
  }, [filePath])

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
      <Grid args={[20, 20]} cellColor="#333" sectionColor="#444" fadeDistance={30} />
      {model && <primitive object={model} />}
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      {/* HUD info overlay is rendered outside Canvas */}
      {info.vertices > 0 && (
        <group>
          {/* Info passed via callback */}
        </group>
      )}
    </>
  )
}

export function ModelPreview() {
  const inputFile = useAppStore((s) => s.inputFile)
  const setInputFile = useAppStore((s) => s.setInputFile)

  if (!inputFile) return null

  return (
    <div style={{
      position: 'relative',
      flex: 1,
      minHeight: '250px',
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
      overflow: 'hidden'
    }}>
      {/* File info bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '8px 12px',
        background: 'rgba(15, 15, 15, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            padding: '2px 6px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600
          }}>
            {inputFile.extension.toUpperCase()}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {inputFile.name}
          </span>
        </div>
        <button
          onClick={() => setInputFile(null)}
          style={{
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            fontSize: '11px',
            border: '1px solid var(--border)'
          }}
        >
          Change
        </button>
      </div>

      <Canvas
        camera={{ position: [4, 3, 4], fov: 50 }}
        style={{ background: '#111' }}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <ModelScene filePath={inputFile.path} />
        </Suspense>
      </Canvas>
    </div>
  )
}
