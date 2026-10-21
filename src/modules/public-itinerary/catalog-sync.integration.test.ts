import 'fake-indexeddb/auto'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest'
import baseline from '../../../supabase/migrations/20261017153621_repository_baseline.sql?raw'
import sync from '../../../supabase/migrations/20261017153641_local_first_sync.sql?raw'
import distance from '../../../supabase/migrations/20261018220000_itinerary_travel_distance.sql?raw'
import migration from '../../../supabase/migrations/20261021042447_public_itinerary_sync.sql?raw'
import { PublicItineraryCatalog, createSharedCatalogCore } from './shared-catalog'
import { TravelDatabase } from '../../database/database'
import { syncPublicCatalog, discardCatalogConflict } from './catalog-sync'
import type { CatalogCloud, CatalogTask, CatalogRecord } from './catalog-sync'
import type { PublicSnapshot } from './models'

const sql = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const basic = '33333333-3333-4333-8333-333333333333'
const dbs: Array<TravelDatabase | PublicItineraryCatalog> = []
async function rpc<T>(user: string, action: string, payload: unknown): Promise<T> {
  await sql.exec(`begin; set local role ${user ? 'authenticated' : 'anon'}`)
  await sql.query("select set_config('request.jwt.claim.sub',$1,true)", [user])
  try {
    const result = await sql.query<{result:T}>('select public.app_public_itinerary($1,$2) as result', [action,payload])
    await sql.exec('commit')
    return result.rows[0].result
  } catch(cause) { await sql.exec('rollback'); throw cause }
}
function cloud(user: string): CatalogCloud {
  return {
    pull: cursor => rpc(user, 'pull', { cursor }),
    push: task => rpc(user, task.action, { id: task.id, sourceTripId: task.sourceTripId, operationId: task.operationId,
      baseVersion: task.baseVersion, ...(task.snapshot && { snapshot: task.snapshot }) }),
  }
}
async function local(user = owner) {
  const catalog = new PublicItineraryCatalog(crypto.randomUUID())
  const workspace = new TravelDatabase(crypto.randomUUID())
  dbs.push(catalog,workspace)
  const region = { id: crypto.randomUUID(), name: '京都', zoom: 12, googlePlaceId: 'kyoto' }
  const trip = { id: crypto.randomUUID(), regionId: region.id, name: '京都散步', startDate:'2026-10-20', endDate:'2026-10-21' }
  const place = { id:crypto.randomUUID(),name:'Cafe',googlePlaceId:'cafe',regionIds:[region.id],labelIds:[],notes:'PRIVATE' }
  await workspace.regions.add(region)
  await workspace.trips.add(trip)
  await workspace.places.add(place)
  await workspace.itineraryItems.add({ id:crypto.randomUUID(),tripId:trip.id,placeId:place.id,date:trip.startDate,order:0,note:'public note',travelDistanceMeters:1000 })
  const core = createSharedCatalogCore(catalog,user,{id:workspace.name,read: fn => workspace.transaction('r',workspace.tables,()=>fn(workspace)),write: fn=>fn(workspace)},()=>{},true)
  return {catalog,workspace,core,trip}
}
beforeAll(async()=> {
  await sql.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`)
  await sql.exec(baseline.replace('create extension if not exists pgcrypto;', ''))
  await sql.exec(`insert into auth.users values('${owner}','a@example.com'),('${other}','b@example.com'),('${basic}','c@example.com');
    update public.user_roles set role='member' where user_id in ('${owner}','${other}');`)
  await sql.exec(sync)
  await sql.exec(distance)
  await sql.exec(migration)
},120000)
afterEach(async()=>{for(const db of dbs.splice(0)) await db.delete()})
afterAll(async()=>{await sql.close()})
it('publishes IndexedDB graphs, pulls on another device/account and applies independent copies',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  await syncPublicCatalog(a.catalog,cloud(owner),owner)
  expect(await a.catalog.syncTasks.count()).toBe(0)
  const b=await local(other)
  await syncPublicCatalog(b.catalog,cloud(other),other)
  expect((await b.core.readSnapshot(row.id)).places[0]).not.toHaveProperty('notes')
  const copy=await b.core.apply(row.id)
  expect((await b.workspace.regions.get(copy.regionId))?.name).toBe('京都(分享)')
  expect((await b.workspace.labels.toArray())[0].name).toBe('京都散步(分享)')
  await expect(b.core.withdraw(row.id,a.trip.id)).rejects.toThrow('FORBIDDEN')
  await a.workspace.trips.delete(a.trip.id)
  expect((await cloud('').pull('0')).records.some(r=>r.id===row.id&&!r.withdrawn)).toBe(true)
  await a.core.withdraw(row.id,a.trip.id)
  await syncPublicCatalog(a.catalog,cloud(owner),owner)
  await syncPublicCatalog(b.catalog,cloud(other),other)
  await expect(b.core.readSnapshot(row.id)).rejects.toThrow('PUBLIC_NOT_FOUND')
  expect(await b.workspace.trips.get(copy.id)).toBeDefined()
})
it('retries a lost response with the same receipt and orders offline publish/update/withdraw',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  await a.workspace.trips.update(a.trip.id,{name:'updated'})
  await a.core.update(row.id,a.trip.id)
  await a.core.withdraw(row.id,a.trip.id)
  let lost=true
  const adapter=cloud(owner)
  const flaky={...adapter,push:async(task:CatalogTask)=>{const result=await adapter.push(task);if(lost){lost=false;throw new Error('lost response')}return result}}
  await expect(syncPublicCatalog(a.catalog,flaky,owner)).rejects.toThrow('lost response')
  expect(await a.catalog.syncTasks.count()).toBe(3)
  await syncPublicCatalog(a.catalog,flaky,owner)
  expect(await a.catalog.syncTasks.count()).toBe(0)
  expect(await a.catalog.publicItineraries.get(row.id)).toBeUndefined()
})
it('detects cross-device version conflicts without overwriting either source',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  await syncPublicCatalog(a.catalog,cloud(owner),owner)
  const b=await local()
  await syncPublicCatalog(b.catalog,cloud(owner),owner)
  const region = await a.workspace.regions.get(a.trip.regionId)
  if (!region) throw new Error('Missing fixture region')
  await b.workspace.regions.put(region)
  await b.workspace.trips.put({...a.trip,name:'device B'})
  await a.workspace.trips.update(a.trip.id,{name:'device A'})
  await a.core.update(row.id,a.trip.id)
  // Cloud versions use no local workspace identity; both devices can edit their synchronized source.
  await b.core.update(row.id,a.trip.id)
  await syncPublicCatalog(a.catalog,cloud(owner),owner)
  await syncPublicCatalog(b.catalog,cloud(owner),owner)
  expect((await b.catalog.syncTasks.toArray())[0].conflict).toBe(true)
  expect((await b.core.readSnapshot(row.id)).trip.name).toBe('device B')
  await discardCatalogConflict(b.catalog,owner,row.id)
  expect((await b.core.readSnapshot(row.id)).trip.name).toBe('device A')
  expect((await b.workspace.trips.get(a.trip.id))?.name).toBe('device B')
})
it('rejects anonymous/basic mutations, foreign owners, private fields and changed receipt payloads',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  const task=(await a.catalog.syncTasks.toArray())[0]
  await expect(cloud('').push(task)).rejects.toThrow('member')
  await expect(cloud(basic).push(task)).rejects.toThrow('member')
  await expect(cloud(owner).push({...task,snapshot:{...task.snapshot!,places:[{...task.snapshot!.places[0],notes:'leak'}]}} as unknown as CatalogTask)).rejects.toThrow('fields')
  const result=await cloud(owner).push(task)
  expect(result.status).toBe('applied')
  await expect(cloud(owner).push({...task,snapshot:{...task.snapshot!,trip:{...task.snapshot!.trip,name:'changed'}}})).rejects.toThrow('reused')
  await expect(cloud(other).push({...task,operationId:crypto.randomUUID(),action:'withdraw',baseVersion:(result as {record:CatalogRecord}).record.version})).rejects.toThrow('publisher')
  expect((await cloud('').pull('0')).records.some(r=>r.id===row.id)).toBe(true)
})
it('clones atomically in cloud mode with an idempotent apply receipt and personal sync events',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  await syncPublicCatalog(a.catalog,cloud(owner),owner)
  const payload={id:row.id,operationId:crypto.randomUUID()}
  const copy=await rpc<{id:string;regionId:string;name:string}>(other,'apply',payload)
  expect(await rpc(other,'apply',payload)).toEqual(copy)
  expect(copy.name).toBe('京都散步（副本）')
  const labels=await sql.query<{name:string;color:string}>("select name,color from public.labels where owner_uid=$1",[other])
  expect(labels.rows.some(r=>r.name==='京都散步(分享)'&&/^#[0-9a-f]{6}$/.test(r.color))).toBe(true)
  const source=await rpc<PublicSnapshot>(other,'source',{sourceTripId:copy.id})
  expect(source.places[0]).not.toHaveProperty('notes')
  expect(source.items[0].travelDistanceMeters).toBe(1000)
  expect(source.region.name).toBe('京都(分享)')
  await expect(rpc(owner,'source',{sourceTripId:copy.id})).rejects.toThrow('belongs')
  expect((await sql.query<{count:number}>("select count(*)::int count from sync_private.events where owner_uid=$1 and entity='trips' and id=$2",[other,copy.id])).rows[0].count).toBe(1)
})
it('pulls all pages and prevents late account responses from committing',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  let active=true
  const adapter=cloud(owner)
  await expect(syncPublicCatalog(a.catalog,{...adapter,pull:async cursor=>{const result=await adapter.pull(cursor);active=false;return result}},owner,()=>{if(!active)throw new Error('account changed')})).rejects.toThrow('account changed')
  expect(await a.catalog.syncMetadata.get('cursor')).toBeUndefined()
  expect(await a.catalog.syncTasks.count()).toBe(1)
  await syncPublicCatalog(a.catalog,adapter,owner)
  let cursor='0';let count=0
  for(;;){const page=await rpc<{records:CatalogRecord[];cursor:string;hasMore:boolean}>('', 'pull',{cursor,limit:1});count+=page.records.length;cursor=page.cursor;if(!page.hasMore)break}
  expect(count).toBeGreaterThan(1)
  expect(await a.core.readSnapshot(row.id)).toBeDefined()
})

it('keeps a newer cloud version when retry returns an older successful receipt',async()=>{
  const a=await local()
  const row=await a.core.publish(a.trip.id)
  const adapter=cloud(owner)
  let accepted: CatalogRecord | undefined
  await expect(syncPublicCatalog(a.catalog,{...adapter,push:async task=>{const result=await adapter.push(task);if(result.status==='applied') accepted=result.record;throw new Error('lost')}},owner)).rejects.toThrow('lost')
  if(!accepted) throw new Error('Missing accepted write')
  const newer={...accepted.snapshot,trip:{...accepted.snapshot.trip,name:'newer cloud'}}
  await adapter.push({operationId:crypto.randomUUID(),id:row.id,sourceTripId:row.sourceTripId,ownerId:owner,action:'update',snapshot:newer,baseVersion:accepted.version,createdAt:Date.now()})
  await syncPublicCatalog(a.catalog,adapter,owner)
  expect((await a.core.readSnapshot(row.id)).trip.name).toBe('newer cloud')
  expect(await a.catalog.syncTasks.count()).toBe(0)
})
