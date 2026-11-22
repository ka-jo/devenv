# Agent container security

<!-- TODO: user-facing explanations. Each section below should say, for someone whose config was rejected or warned
about, what the rule protects against and how to change their config, and keep its link to the rule's specification. -->

devenv checks every dev container config before building a sandbox from it, and `devenv container validate` runs the same validation on its own. A finding names its rule in brackets, such as `[privileged]`; that rule's section is below.

The rules are specified in [RFC-0004: Config validation](rfcs/0004-config-validation.md). Findings marked as a sandbox escape block the config; findings marked as host exposure are warnings for whoever approves the config ([ADR-0005](adrs/0005-approve-every-dev-container-configs-exact-content-before-building-from-it.md)).

## privileged

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.1](rfcs/0004-config-validation.md#4221-privileged) and [§4.2.4.1](rfcs/0004-config-validation.md#4241-privileged).

## host-namespaces

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.2](rfcs/0004-config-validation.md#4222-host-namespaces).

## network-mode

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.3](rfcs/0004-config-validation.md#4223-network-mode).

## capabilities

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.4](rfcs/0004-config-validation.md#4224-capabilities) and [§4.2.4.2](rfcs/0004-config-validation.md#4242-capabilities).

## security-opt

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.5](rfcs/0004-config-validation.md#4225-security-options) and [§4.2.4.3](rfcs/0004-config-validation.md#4243-security-options).

## devices

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.6](rfcs/0004-config-validation.md#4226-devices).

## docker-socket

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.1.3](rfcs/0004-config-validation.md#4213-container-runtime-sockets).

## external-networks

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.3.2](rfcs/0004-config-validation.md#4232-external-networks).

## build-network

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.2.9](rfcs/0004-config-validation.md#4229-build-network).

## compose-includes

Sandbox escape. TODO: explain. Specified in RFC-0004 [§4.2.5](rfcs/0004-config-validation.md#425-raw-compose-files).

## host-paths

Host exposure. TODO: explain. Specified in RFC-0004 [§4.2.1.4](rfcs/0004-config-validation.md#4214-host-paths-outside-the-allowed-roots).

## volume-driver-opts

Host exposure. TODO: explain. Specified in RFC-0004 [§4.2.3.3](rfcs/0004-config-validation.md#4233-volume-driver-devices).

## config-folder

Host exposure. TODO: explain. Specified in RFC-0004 [§4.2.6](rfcs/0004-config-validation.md#426-config-folder).
