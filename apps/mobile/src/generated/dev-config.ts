export interface DevConnectionConfig {
  name: string;
  androidHost: string;
  iosHost: string;
  port: number;
  bearerToken: string;
}

export const devConnectionConfig: DevConnectionConfig | null = {
  name: "This Machine",
  androidHost: "10.0.2.2",
  iosHost: "192.168.1.13",
  port: 3774,
  bearerToken: "sk-stavi-a82bb89f431bd01792703abce3fa79fedf17",
};
