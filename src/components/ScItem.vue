<template>
    <div class="container">
        <div class="face-name-label">
            <div class="face">
                <BiliImg :src="face" :default="img.defaultFace" />
            </div>
            <div class="name">{{ name }}</div>
            <div class="price">{{ price + "CNY" }}</div>
        </div>
        <div class="sc-content">
            <span>{{ text }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import BiliImg from "./BiliImg.vue";
import Colors from "../detail/Colors.ts";
import { computed } from "vue";
import { img } from "../detail/Assets.ts";

const props = defineProps<{
    face?: string;
    name?: string;
    text?: string;
    price?: number;
}>();
const scColor = computed(() => {
    if (props.price) {
        const p = props.price;
        if (p < 50) {
            return { front: Colors.SC_BLUE_FRONT, back: Colors.SC_BLUE_BACK };
        } else if (p >= 50 && p < 100) {
            return {
                front: Colors.SC_GREYBLUE_FRONT,
                back: Colors.SC_GREYBLUE_BACK,
            };
        } else if (p >= 100 && p < 500) {
            return {
                front: Colors.SC_YELLOW_FRONT,
                back: Colors.SC_YELLOW_BACK,
            };
        } else if (p >= 500 && p < 1000) {
            return {
                front: Colors.SC_ORANGE_FRONT,
                back: Colors.SC_ORANGE_BACK,
            };
        } else {
            return { front: Colors.SC_RED_FRONT, back: Colors.SC_RED_BACK };
        }
    }
});
</script>

<style scoped>
.price {
    margin-left: auto;
    margin-right: 1em;
}
.sc-content {
    min-height: 3.2em;
    background-color: v-bind("scColor?.front");
    border-radius: 0 0 16px 16px;
    color: white;
    padding: 0.5em;
    width: 100%;
    box-sizing: border-box;
    font-size: 0.8em;
}
.name {
    display: inline-block;
    font-size: 1em;
}
.face {
    height: 2em;
    aspect-ratio: 1;
    border-radius: 50%;
    background-color: gray;
    display: inline-block;
    margin: 0.5em;
    overflow: hidden;
}
.face-name-label {
    min-height: 3.2em;
    display: flex;
    width: 100%;
    box-sizing: border-box;
    background-color: v-bind("scColor?.back");
    color: v-bind("scColor?.front");
    border-radius: 16px 16px 0 0;
    gap: 0.5em;
    align-items: center;
    font-weight: bold;
}
.container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    align-items: center;
    width: 100%;
}
</style>
