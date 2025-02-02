"use client";
import { Background, Edge, MarkerType, Node, Position, ReactFlow, ReactFlowInstance, ReactFlowProvider, useEdgesState, useNodesState } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import styles from "./Home.module.scss";

import '@xyflow/react/dist/style.css';

import SendingEdge from "../components/SendingEdge";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartData
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { Button, ButtonGroup, Slider } from "@heroui/react";
import "chart.js/auto";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const edgeTypes = {
  sending: SendingEdge,
};

interface Config {
  throughput: number,
  timeout: number,
  dataSize: number,
  dataSigma: number,
  requestRate: number, // per second
  mode: "RR" | "LC"
}

interface Server {
  id: number,
  queue: Data[],
  current?: Data,
}

interface Client {
  id: number
}

interface LoadBalancer {
  queue: Request[],
  lastServer: number,
}

interface Request {
  id: string,
  path: string,
  createdAt: number,
  source: number,
}

interface Data {
  id: string,
  size: number,
  done: number,
  createdAt: number,
  timeoutAt: number,
  source: number,
  target: number,
}

export default function Home() {

  const initialServers: Server[] = [{
    id: 1,
    queue: [],
    current: undefined,
  }, {
    id: 2,
    queue: [],
    current: undefined,
  }, {
    id: 3,
    queue: [],
    current: undefined,
  }];

  const initialClients: Client[] = [{
    id: 1,
  }]

  const initialLoadBalancer: LoadBalancer = {
    queue: [],
    lastServer: 0,
  }

  const init = () => {
    const initialNodes: Node[] = [];

    const maxHeight = Math.max(servers.length, clients.length);
    let clientPad = (maxHeight - clients.length) * 50;
    let serverPad = (maxHeight - servers.length) * 50;
    let lbPad = maxHeight * 50 + 50;

    initialNodes.push(...initialServers.map((server, i) => {
      return {
        id: `s${server.id}`,
        data: {
          label: `Server ${server.id}`,
        },
        position: {
          x: 500,
          y: (i * 100) + 100 + serverPad,
        },
        width: 100,
        sourcePosition: Position.Left,
        targetPosition: Position.Left,
        className: styles.node,
        style: {
          color: "black"
        },
        draggable: false,
        connectable: false,
      }
    }));
    initialNodes.push(...initialClients.map((client, i) => {
      return {
        id: `c${client.id}`,
        data: {
          label: `Client ${client.id}`
        },
        position: {
          x: 100,
          y: (i * 100) + 100 + clientPad,
        },
        width: 100,
        sourcePosition: Position.Right,
        targetPosition: Position.Right,
        className: styles.node,
        style: {
          color: "black"
        },
        draggable: false,
        connectable: false,
      }
    }));
    initialNodes.push({
      id: `lb`,
      data: {
        label: `Load Balancer`
      },
      position: {
        x: 300,
        y: 100 + lbPad,
      },
      width: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      className: styles.node,
      style: {
        color: "black"
      },
      draggable: false,
      connectable: false,
    });

    setNodes(initialNodes);

    const initialEdges: Edge[] = [];

    initialServers.map((server, i) => {
      initialEdges.push({
        id: `lb-s${server.id}`,
        source: `lb`,
        target: `s${server.id}`,
      })
    });

    clients.map((client, i) => {
      initialEdges.push({
        id: `c${client.id}-lb`,
        source: `c${client.id}`,
        target: `lb`
      })
    });

    setEdges(initialEdges);

    setInterval(() => {
      setDelEdge((cDelEdge) => {
        const data = [...cDelEdge];
        setEdges((cEdges) => cEdges.filter((ed) => !data.includes(ed.id)))
        return [];
      })
    }, 50);

  };

  const initialConfig: Config = {
    dataSize: 1000,
    dataSigma: 10,
    requestRate: 10, // per sec
    throughput: 1000,
    timeout: 100000, // ms
    mode: "LC",
  };


  const [config, setConfig] = useState<Config>(initialConfig);

  const [servers, setServers] = useState<Server[]>(initialServers);
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [loadbalancer, setLoadbalancer] = useState<LoadBalancer>(initialLoadBalancer);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [reactflow, setReactflow] = useState<ReactFlowInstance>();

  const [running, setRunning] = useState(false);
  const runningRef = useRef(running);

  const [tempRateCache, setTempRateCache] = useState<number[]>([]);
  const [requestRateCache, setRequestRateCache] = useState<number[]>([]);

  const [fileSizeCache, setFileSizeCache] = useState<number[]>([]);
  const [requestCounterBuffer, setRequestCounterBuffer] = useState<Request[]>([]);
  const [requestCounter, setRequestCounter] = useState<number[]>([]);
  const [timeoutCounterBuffer, setTimeoutCounterBuffer] = useState<Data[]>([]);
  const [timeoutCounter, setTimeoutCounter] = useState<number[]>([]);
  const [processRateCounterBuffer, setProcessRateCounterBuffer] = useState<Data[]>([]);
  const [processRateCounter, setProcessRateCounter] = useState<number[]>([]);

  const [filesizeCounter, setFilesizeCounter] = useState<number[]>([]);

  useEffect(() => {
    runningRef.current = running;

    if (!running) {
      setEdges((edges) => edges.filter((e) => !e.id.match(/[0-9a-zA-Z]{8}-[0-9a-zA-Z]/)))
    }
  }, [running]);

  const nextPoisson = (lambda: number) => {
    let xp = Math.random();
    let k = 0;
    while (xp >= Math.exp(-lambda)) {
      xp = xp * Math.random();
      k = k + 1;
    }
    return k;
  };

  const setRequestRate = async (rate: number) => {
    let tempCache = tempRateCache;
    if (tempCache.length == 0) {
      for (let i = 0; i < 500; i++) {
        tempCache.push(nextPoisson(100) / 100);
      }
      setTempRateCache(tempCache);
    }
    setConfig((c) => {
      return {
        ...c,
        requestRate: rate
      }
    });
    // 1秒あたりの件数を平均値に変換
    const mean = 1000 / rate;
    // tempCacheをシャッフル
    for (let i = tempCache.length - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      let tmp = tempCache[i];
      tempCache[i] = tempCache[r];
      tempCache[r] = tmp;
    }
    const cache = tempCache.map((v) => Math.round(v * mean));
    setRequestRateCache(cache);
  }

  const setServerTimeout = async (timeout: number) => {
    setConfig((c) => {
      return {
        ...c,
        timeout: timeout
      }
    });
  }

  const setThroughput = (throughput: number) => {
    setConfig((c) => {
      return {
        ...c,
        throughput: throughput
      }
    });
  }

  const setLBType = (type: typeof config.mode) => {
    setConfig((c) => {
      return {
        ...c,
        mode: type
      }
    })
  };

  const setFileSizeM = (filesize: number) => {
    setConfig((c) => {
      return {
        ...c,
        dataSize: filesize
      }
    });
  };

  const setFileSizeS = (sigma: number) => {
    setConfig((c) => {
      return {
        ...c,
        dataSigma: sigma
      }
    });
  }

  const normRand = (m = config.dataSize, s = config.dataSigma) => {
    const a = 1 - Math.random();
    const b = 1 - Math.random();
    const c = Math.sqrt(-2 * Math.log(a));
    if (0.5 - Math.random() > 0) {
      return c * Math.sin(Math.PI * 2 * b) * s + m;
    } else {
      return c * Math.cos(Math.PI * 2 * b) * s + m;
    }
  };

  const getFileSize = (path: string) => {
    return Math.round(normRand());
  };

  const getNextDelay = () => {
    if (requestRateCache.length == 0) {
      setRequestRate(config.requestRate);
    }
    const rand = Math.floor(Math.random() * requestRateCache.length) % requestRateCache.length;
    return requestRateCache[rand];
  };


  const [temp1, setTemp1] = useState<string[]>([]);
  const [delEdge, setDelEdge] = useState<string[]>([]);
  const delEdgeRef = useRef(delEdge);

  const startSimulation = () => {
    setRunning(true);
    if (requestRateCache.length == 0) {
      setRequestRate(config.requestRate);
    }
    clients.forEach((client) => {
      setTimeout(() => send(client), getNextDelay())
    });
    const calcRate = config.throughput / 100;
    const interval = setInterval((handler, timeout) => {
      if (!runningRef.current) {
        clearInterval(interval);
      }
      const now = Date.now();
      setServers((servers) => {
        return [...servers.map((server) => {
          if (server.queue.length == 0 && server.current == undefined) return server;
          let calclated = 0;
          while (calclated < calcRate) {
            if (server.current == undefined) {
              server.current = server.queue.shift();
              if (server.current == undefined) break;
              setEdges((edges) => edges.concat({
                id: server.current?.id ?? "",
                target: `c${server.current?.source}`,
                source: `s${server.id}`,
                type: "sending"
              }))
            }
            if (server.current.timeoutAt <= now) {
              const timeoutData = server.current;
              setTimeoutCounterBuffer((buf) => buf.concat(timeoutData));
              server.current = undefined;
              continue;
            }
            const calcSize = Math.min(calcRate - calclated, server.current.size - server.current.done);
            server.current.done += calcSize;
            calclated += calcSize;

            if (server.current.size <= server.current.done) {
              setDelEdge((t) => [...t, server.current?.id ?? "error2"]);
              const data = server.current;
              setProcessRateCounterBuffer((buff) => buff.concat(data));
              server.current = undefined;
              // 処理完了
            }
          }

          server.queue.filter((data) => {
            if (data.timeoutAt <= now) {
              // TODO
              return false;
            } else {
              return true;
            }
          })
          return server;
        })]
      })
    }, 10);

    const countInterval = setInterval(async () => {
      setRequestCounterBuffer((buffer) => {
        setRequestCounter((c) => c.concat(buffer.length));
        return [];
      });
      setTimeoutCounterBuffer((buffer) => {
        setTimeoutCounter((c) => c.concat(buffer.length));
        return [];
      });
      setProcessRateCounterBuffer((buffer) => {
        setProcessRateCounter((c) => c.concat(buffer.length));
        return [];
      });
      if (!runningRef.current) {
        clearInterval(countInterval);
      }
    }, 1000)
  }

  const send = (client: Client) => {
    if (runningRef.current) {
      const id = crypto.randomUUID().slice(0, 10);
      const request: Request = {
        id: id,
        path: id,
        createdAt: Date.now(),
        source: client.id,
      };
      console.log(`${id} send to lb`)
      setLoadbalancer((lb) => {
        console.log("A" + config.requestRate)
        return {
          ...lb,
          queue: [...lb.queue, request]
        }
      });
      setRequestCounterBuffer((buf) => buf.concat(request));
      const sendEdge: Edge = {
        id: `req${id}`,
        source: `c${client.id}`,
        target: "lb",
        type: "sending",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#FF0072',
        },
        style: {
          strokeWidth: 1,
          stroke: "#FF0072"
        }
      };
      setEdges((edges) => edges.concat(sendEdge));
      setTimeout(() => {
        setEdges((edges) => edges.filter((e) => e.id != sendEdge.id));
      }, 500)
      const next = getNextDelay();
      setTimeout(() => send(client), next);
    }
  };

  useEffect(() => {
    if (loadbalancer.queue.length == 0) {
      return;
    }
    let server;
    switch (config.mode) {
      case "RR":
        server = servers[(loadbalancer.lastServer + 1) % servers.length].id;
        break;
      case "LC":
        server = servers.sort((a, b) => a.queue.length - b.queue.length)[0].id;
        console.log(server);
        break;
      default:
        return;
    }
    setLoadbalancer((lb) => {
      const data = lb.queue.shift();
      if (data) {
        setServers((servers) => {
          return servers.map((sv) => {
            if (sv.id == server) {
              const newData = {
                id: data.id,
                size: getFileSize(data.path),
                source: data.source,
                target: server,
                createdAt: data.createdAt,
                timeoutAt: data.createdAt + config.timeout,
                done: 0
              };
              sv?.queue.push(newData);
              setFilesizeCounter((c) => {
                while (c.length <= newData.size) {
                  c = c.concat(0);
                }
                c[newData.size]++;
                return c;
              });
            }
            return sv;
          })
        });
      }
      return {
        ...lb,
        lastServer: server,
        queue: lb.queue
      }
    })
  }, [loadbalancer.queue])


  const addServer = () => {
    setServers((current) => {
      const newServer = {
        id: (current[current.length - 1].id ?? 1) + 1,
        queue: []
      };

      const newNode: Node = {
        id: `s${newServer.id}`,
        data: {
          label: `Server ${newServer.id}`,
        },
        position: {
          x: 500,
          y: 100,
        },
        width: 100,
        sourcePosition: Position.Left,
        targetPosition: Position.Left,
        style: {
          color: "black"
        },
        draggable: false,
        connectable: false,
      };

      setNodes((nodes) => nodes.concat(newNode));

      const newEdge = {
        id: `lb-s${newServer.id}`,
        source: `lb`,
        target: `s${newServer.id}`,
      };

      setEdges((edges) => edges.concat(newEdge));
      return [...current, newServer];
    });
  };

  const addCLient = () => {
    setClients((current) => {
      const newClient = {
        id: (current[current.length - 1].id ?? 1) + 1
      };

      const newNode: Node = {
        id: `c${newClient.id}`,
        data: {
          label: `Client ${newClient.id}`,
        },
        position: {
          x: 100,
          y: 100,
        },
        width: 100,
        sourcePosition: Position.Right,
        targetPosition: Position.Right,
        style: {
          color: "black"
        },
        draggable: false,
        connectable: false,
      };

      setNodes((nodes) => nodes.concat(newNode));

      const newEdge = {
        id: `c${newClient.id}-lb`,
        source: `c${newClient.id}`,
        target: `lb`,
      };

      setEdges((edges) => edges.concat(newEdge));
      return [...current, newClient];
    });
  };



  const updateFlow = () => {
    console.log(servers);
    const maxHeight = Math.max(servers.length, clients.length);
    let clientPad = (maxHeight - clients.length) * 50 + 100;
    console.log(clientPad)
    console.log(maxHeight)
    console.log(clients.length)
    let serverPad = (maxHeight - servers.length) * 50 + 100;
    console.log(clientPad)
    let lbPad = maxHeight * 50 + 50;
    setNodes((nodes) => [...nodes.map((node) => {
      if (node.id == "lb") {
        return {
          ...node,
          position: {
            x: 300,
            y: lbPad,
          }
        }
      } else if (node.id.startsWith("s")) {
        return {
          ...node,
          position: {
            x: 500,
            y: ((parseInt(node.id.replace("s", "")) - 1) * 100) + serverPad
          }
        }
      } else if (node.id.startsWith("c")) {
        return {
          ...node,
          position: {
            x: 100,
            y: ((parseInt(node.id.replace("c", "")) - 1) * 100) + clientPad
          }
        }
      }
      return node;
    })]);
  };

  const reset = () => {
    setServers(initialServers);
    setClients(initialClients);
    setLoadbalancer(initialLoadBalancer);
    setNodes([]);
    setEdges([]);
    init();
    updateFlow();
    setRequestCounterBuffer([]);
    setRequestCounter([]);
    setTimeoutCounterBuffer([]);
    setTimeoutCounter([]);
    setProcessRateCounterBuffer([]);
    setProcessRateCounter([]);
    setFilesizeCounter([]);
  }

  useEffect(() => {
    updateFlow();
  }, [servers.length, clients.length]);

  useEffect(() => {
    reactflow?.fitView();
  }, [nodes]);

  const [temp, setTemp] = useState(0);
  const [list, setList] = useState<number[]>([]);
  const [count, setCount] = useState<number[]>([]);
  const [show, setShow] = useState(0);


  useEffect(() => {
    init();
    updateFlow();
    setRequestRate(config.requestRate);


    setTemp((temp) => {
      const n = nextPoisson(100);
      setList((l) => [...l, n]);
      setCount((c) => {
        while (c.length < n) {
          c = [...c, 0];
        }
        if (!c[n]) {
          c[n] = 1;
        } else {
          c[n] = c[n] + 1;
        }
        return c;
      })
      return n;
    });
  }, []);

  useEffect(() => {
    setShow((s) => {
      let sum = list.reduce((ss, el) => ss + el, 0);
      return sum / list.length;
    })
  }, [list]);


  const [data, setData] = useState<ChartData<"bar">>({
    labels: [list.map((j, i) => i)],
    datasets: [
      {
        label: "Data",
        data: count,
        backgroundColor: "red"
      }
    ]
  });

  const lineData: ChartData<"line"> = {
    labels: requestCounter.map((v, i) => i.toString()),
    datasets: [
      {
        label: "リクエスト数",
        data: requestCounter,
        borderColor: "green",
        backgroundColor: "blue",
      }
    ]
  };

  useEffect(() => {
    setData((d) => {
      return {
        ...d,
        labels: count.map((j, i) => `${i}`),
        datasets: [
          {
            label: "Data",
            data: count
          }
        ]
      }
    })
  }, [count, list]);

  const barOptions = {
    plugins: {
      title: {
        display: true,
        text: 'Chart.js Bar Chart - Stacked',
      },
    },
    responsive: true,
    scales: {
      x: {
        stacked: true,
      },
      y: {
        stacked: true,
      },
    },
  };


  return (
    <div className="w-full">
      <Button onPress={() => addServer()} className="m-1">サーバを追加</Button>
      <Button onPress={() => addCLient()} className="m-1">クライアントを追加</Button>
      <Button onPress={() => updateFlow()} className="m-1">表示を修正</Button><br />
      <Button onPress={() => startSimulation()} className="m-1" isDisabled={running}>スタート</Button>
      <Button onPress={() => setRunning(false)} className="m-1" isDisabled={!running}>ストップ</Button>
      <Button onPress={() => reset()} className="m-1" isDisabled={running}>初期化</Button>
      <Slider className="max-w-md" defaultValue={config.requestRate} label="リクエストレート" onChange={(e) => { setRequestRate(e as number) }} step={1} minValue={1} maxValue={500} getValue={(val) => `${val}リクエスト / 秒`} marks={[{ value: 1, label: "1" }, { value: 100, label: "100" }, { value: 200, label: "200" }, { value: 300, label: "300" }, { value: 400, label: "400" }, { value: 500, label: "500" }]} isDisabled={running} />
      <Slider className="max-w-md" defaultValue={Math.round(config.timeout / 1000)} label="タイムアウト" onChange={(e) => { setServerTimeout((e as number) * 1000) }} step={0.1} minValue={0.1} maxValue={100} getValue={(val) => `${val}秒`} marks={[{ value: 0.1, label: "0" }, { value: 25, label: "25" }, { value: 50, label: "50" }, { value: 75, label: "75" }, { value: 100, label: "100" }]} isDisabled={running} />
      <Slider className="max-w-md" defaultValue={config.throughput} label="スループット" onChange={(e) => { setThroughput((e as number)) }} step={1} minValue={1} maxValue={10000} getValue={(val) => `${val} バイト / 秒`} marks={[{ value: 1, label: "0" }, { value: 2500, label: "2500" }, { value: 5000, label: "5000" }, { value: 7500, label: "7500" }, { value: 10000, label: "10000" }]} isDisabled={running} />
      <div className="">
        <h3>ファイルサイズ</h3>
        <Slider className="max-w-md" defaultValue={config.dataSize} label="平均" onChange={(e) => { setFileSizeM((e as number) * 1000) }} step={10} minValue={10} maxValue={3000} getValue={(val) => `${val} バイト`} marks={[{ value: 10, label: "10" }, { value: 500, label: "500" }, { value: 1000, label: "1000" }, { value: 1500, label: "1500" }, { value: 2000, label: "2000" }, { value: 2500, label: "2500" }, { value: 3000, label: "3000" }]} isDisabled={running} />
        <Slider className="max-w-md" defaultValue={config.dataSigma} label="分散" onChange={(e) => { setFileSizeS((e as number) * 1000) }} step={0.1} minValue={0} maxValue={20} getValue={(val) => `${val}`} marks={[{ value: 0, label: "0" }, { value: 10, label: "10" }, { value: 20, label: "20" }]} isDisabled={running} />
      </div>
      <div className="my-4">
        <label className="m-1" htmlFor="lbargo" >ロードバランサアルゴリズム</label>
        <ButtonGroup isDisabled={running} id="lbargo">
          <Button onPress={() => setLBType("RR")} color={config.mode == "RR" ? "primary" : "default"}>ラウンドロビン</Button>
          <Button onPress={() => setLBType("LC")} color={config.mode == "LC" ? "primary" : "default"}>最小接続数</Button>
        </ButtonGroup>
      </div>
      <div style={{ width: "100vw", maxHeight: "50dvh", display: "flex", flexDirection: "row", position: "relative" }}>
        <Line width={200} style={{ float: "left" }} data={{
          labels: requestCounter.map((v, i) => i.toString()),
          datasets: [
            {
              label: "リクエスト数",
              data: requestCounter,
              borderColor: "palegreen",
            },
            {
              label: "タイムアウト数",
              data: timeoutCounter,
              borderColor: "orangered"
            },
            {
              label: "プロセスレート",
              data: processRateCounter,
              borderColor: "red"
            }
          ]
        }}
          options={{
            scales: {
              y: {
                min: 0,
              }
            }
          }}></Line>
        <Bar width={200} style={{ float: "left" }} options={barOptions} data={{
          labels: filesizeCounter.slice(config.dataSize - config.dataSigma * 3, config.dataSize + config.dataSigma * 3).map((v, i) => i),
          datasets: [
            {
              label: "ファイルサイズ",
              data: filesizeCounter.slice(config.dataSize - config.dataSigma * 3, config.dataSize + config.dataSigma * 3),
            }
          ]
        }}></Bar>
      </div>
      <div style={{ width: "100vw", maxHeight: "50dvh", height: "50dvh" }}>
        <ReactFlowProvider fitView>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView minZoom={0.2} style={{ height: "100%", width: "100%" }} onInit={(instance) => setReactflow(instance)} edgeTypes={edgeTypes} draggable={false} contentEditable={false} zoomOnScroll={false} zoomOnDoubleClick={false} panOnDrag={false}>
            <Background />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
