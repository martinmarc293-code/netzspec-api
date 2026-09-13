# III.1 renames vs the one-cup-set-per-kind contract (cisco tree @ 3aff73b, question set at nothing known)

## psu -> power
- FROM servers-unified-computing.psu: [input_voltage, product_compatibility, psu_rated_output]
- FROM hyperconverged-systems.psu: [input_voltage, product_compatibility, psu_rated_output]
- FROM hyperconverged-infrastructure.psu: [input_voltage, product_compatibility, psu_rated_output]
- TARGET switches.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET wireless.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET video.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET routers.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET optical-networking.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET storage-networking.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET security.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET interfaces-modules.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET data-center-networking.power: [airflow, input_voltage, product_compatibility, psu_rated_output]

## power-supply -> power
- FROM unified-communications.power-supply: [product_compatibility, psu_rated_output]
- FROM collaboration-endpoints.power-supply: [product_compatibility, psu_rated_output]
- FROM conferencing.power-supply: [product_compatibility, psu_rated_output]
- TARGET switches.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET wireless.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET video.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET routers.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET optical-networking.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET storage-networking.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET security.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET interfaces-modules.power: [airflow, input_voltage, product_compatibility, psu_rated_output]
- TARGET data-center-networking.power: [airflow, input_voltage, product_compatibility, psu_rated_output]

## line-card -> linecard
- FROM video.line-card: [product_compatibility]
- TARGET switches.linecard: [fabric_bandwidth, poe_ports(g), poe_standard, ports, power_max, product_compatibility]
- TARGET routers.linecard: [fabric_bandwidth, ports, power_max, product_compatibility]
- TARGET optical-networking.linecard: [data_rate, ports, power_max, product_compatibility]
- TARGET storage-networking.linecard: [data_rate, ports, power_max, product_compatibility]
- TARGET data-center-networking.linecard: [ports, power_max, product_compatibility]

## enterprise -> router
- FROM routers.enterprise: [acl_entries, altitude_max, certifications, dimensions, dram, flash, form_factor, humidity_operating, input_voltage, ipsec_throughput, ipsec_tunnels, ipv4_routes, ipv6_routes, lan_interfaces, module_slots(g), nat_sessions, ports, power_max, power_typical, rack_units(g), router_throughput, temp_operating, temp_storage, vlan_max, wan_interfaces, weight]
- target name `router` exists in no category today

## other -> unknown
- FROM wireless.other: []
- FROM optical-networking.other: []
- FROM storage-networking.other: []
- TARGET servers-unified-computing.unknown: []
- TARGET hyperconverged-systems.unknown: []
- TARGET hyperconverged-infrastructure.unknown: []
- TARGET video.unknown: []
- TARGET unified-communications.unknown: []
- TARGET collaboration-endpoints.unknown: []
- TARGET conferencing.unknown: []
- TARGET meraki.unknown: [dimensions, humidity_operating, mounting, power_max, psu_options, temp_operating, weight]

## daughter -> module
- FROM switches.daughter: [product_compatibility]
- FROM data-center-networking.daughter: [product_compatibility]
- TARGET switches.module: [poe_ports(g), poe_standard, ports, product_compatibility]
- TARGET wireless.module: [product_compatibility]
- TARGET routers.module: [ports, product_compatibility]
- TARGET security.module: [ports, power_max, product_compatibility]
- TARGET interfaces-modules.module: [product_compatibility]
- TARGET data-center-networking.module: [ports, product_compatibility]

## stack-module -> module
- FROM switches.stack-module: [product_compatibility]
- FROM data-center-networking.stack-module: [product_compatibility]
- TARGET switches.module: [poe_ports(g), poe_standard, ports, product_compatibility]
- TARGET wireless.module: [product_compatibility]
- TARGET routers.module: [ports, product_compatibility]
- TARGET security.module: [ports, power_max, product_compatibility]
- TARGET interfaces-modules.module: [product_compatibility]
- TARGET data-center-networking.module: [ports, product_compatibility]

## security-module -> module
- FROM security.security-module: [concurrent_sessions, firewall_throughput, ips_throughput, ipsec_throughput, power_max, product_compatibility, threat_throughput, tls_throughput, vpn_peers]
- TARGET switches.module: [poe_ports(g), poe_standard, ports, product_compatibility]
- TARGET wireless.module: [product_compatibility]
- TARGET routers.module: [ports, product_compatibility]
- TARGET security.module: [ports, power_max, product_compatibility]
- TARGET interfaces-modules.module: [product_compatibility]
- TARGET data-center-networking.module: [ports, product_compatibility]

## ips-module -> module
- FROM security.ips-module: [ips_throughput, power_max, product_compatibility]
- TARGET switches.module: [poe_ports(g), poe_standard, ports, product_compatibility]
- TARGET wireless.module: [product_compatibility]
- TARGET routers.module: [ports, product_compatibility]
- TARGET security.module: [ports, power_max, product_compatibility]
- TARGET interfaces-modules.module: [product_compatibility]
- TARGET data-center-networking.module: [ports, product_compatibility]

## switch (storage-networking) -> fc-switch
- FROM storage-networking.switch: [airflow, certifications, data_rate, dimensions, humidity_operating, ports, power_max, rack_units, temp_operating, weight]
- target name `fc-switch` exists in no category today

## forwarding -> linecard
- FROM routers.forwarding: [product_compatibility]
- TARGET switches.linecard: [fabric_bandwidth, poe_ports(g), poe_standard, ports, power_max, product_compatibility]
- TARGET routers.linecard: [fabric_bandwidth, ports, power_max, product_compatibility]
- TARGET optical-networking.linecard: [data_rate, ports, power_max, product_compatibility]
- TARGET storage-networking.linecard: [data_rate, ports, power_max, product_compatibility]
- TARGET data-center-networking.linecard: [ports, power_max, product_compatibility]