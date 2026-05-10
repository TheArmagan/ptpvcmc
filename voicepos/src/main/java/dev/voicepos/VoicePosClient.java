package dev.voicepos;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

public class VoicePosClient implements ClientModInitializer {

    private static final int SEND_INTERVAL_TICKS = 1;
    private static final int JUKEBOX_SCAN_RADIUS = 32;
    private static final int JUKEBOX_SCAN_INTERVAL_TICKS = 20 * 5;

    private String endpoint = "http://localhost:7270/positions";
    private double range = 96.0;

    private final HttpClient http = HttpClient.newHttpClient();
    private int tickCounter = 0;
    private int jukeboxScanCounter = JUKEBOX_SCAN_INTERVAL_TICKS; // scan immediately on first tick
    private List<String> cachedJukeboxJson = new ArrayList<>();

    @Override
    public void onInitializeClient() {
        loadConfig();
        ClientTickEvents.END_CLIENT_TICK.register(this::onTick);
    }

    private void loadConfig() {
        Path configFile = FabricLoader.getInstance().getConfigDir().resolve("voicepos.properties");
        Properties props = new Properties();

        if (!Files.exists(configFile)) {
            // write defaults so the user can edit the file
            props.setProperty("endpoint", endpoint);
            props.setProperty("range", String.valueOf((int) range));
            try (OutputStream out = Files.newOutputStream(configFile)) {
                props.store(out, "voicepos config — set endpoint to your host's IP:port");
            } catch (IOException e) {
                System.err.println("[voicepos] could not write default config: " + e.getMessage());
            }
            return;
        }

        try (InputStream in = Files.newInputStream(configFile)) {
            props.load(in);
            endpoint = props.getProperty("endpoint", endpoint).trim();
            range = Double.parseDouble(props.getProperty("range", String.valueOf((int) range)).trim());
        } catch (IOException | NumberFormatException e) {
            System.err.println("[voicepos] could not read config, using defaults: " + e.getMessage());
        }
    }

    private void onTick(Minecraft client) {
        if (client.player == null || client.level == null) return;

        tickCounter++;
        if (tickCounter < SEND_INTERVAL_TICKS) return;
        tickCounter = 0;

        Player self = client.player;
        Vec3 selfPos = self.position();
        String worldName = client.level.dimension().location().toString();

        // refresh jukebox scan once per second
        jukeboxScanCounter++;
        if (jukeboxScanCounter >= JUKEBOX_SCAN_INTERVAL_TICKS) {
            jukeboxScanCounter = 0;
            cachedJukeboxJson = scanNearbyJukeboxes(client, self, worldName);
        }

        // build nearby players list (all in same dimension as self)
        List<String> nearbyJson = new ArrayList<>();
        for (Player other : client.level.players()) {
            if (other == self) continue;
            if (other.distanceTo(self) > range) continue;
            Vec3 pos = other.position();
            nearbyJson.add(String.format(Locale.ROOT,
                "{\"name\":\"%s\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f,\"world\":\"%s\"}",
                other.getName().getString(), pos.x, pos.y, pos.z, worldName
            ));
        }

        // build full json payload
        String json = String.format(Locale.ROOT,
            "{\"self\":{\"name\":\"%s\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f,\"yaw\":%.2f,\"world\":\"%s\"}," +
            "\"nearby\":[%s],\"jukeboxes\":[%s]}",
            self.getName().getString(),
            selfPos.x, selfPos.y, selfPos.z,
            self.getYRot(),
            worldName,
            String.join(",", nearbyJson),
            String.join(",", cachedJukeboxJson)
        );

        // fire and forget — don't block the game thread
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(endpoint))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        http.sendAsync(request, HttpResponse.BodyHandlers.discarding())
            .exceptionally(e -> null); // silently ignore if server not running
    }

    private List<String> scanNearbyJukeboxes(Minecraft client, Player self, String worldName) {
        List<String> result = new ArrayList<>();
        BlockPos center = self.blockPosition();
        int r = JUKEBOX_SCAN_RADIUS;
        for (int dx = -r; dx <= r; dx++) {
            for (int dy = -r; dy <= r; dy++) {
                for (int dz = -r; dz <= r; dz++) {
                    BlockPos pos = center.offset(dx, dy, dz);
                    if (!client.level.isLoaded(pos)) continue;
                    if (client.level.getBlockState(pos).is(Blocks.JUKEBOX)) {
                        result.add(String.format(Locale.ROOT,
                            "{\"x\":%d,\"y\":%d,\"z\":%d,\"world\":\"%s\"}",
                            pos.getX(), pos.getY(), pos.getZ(), worldName
                        ));
                    }
                }
            }
        }
        return result;
    }
}
